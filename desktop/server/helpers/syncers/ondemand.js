const fs = require("fs-extra");
const path = require("path");
const mkdirp = require("mkdirp");
const glob = require("glob");
const accountModel = require("../../models/account");
const remote = require("../remote");
const nodeModel = require("../../models/node");
const errorLogModel = require("../../models/log-error");
const _base = require("./_base");
const rimraf = require('rimraf');

// Logger
const { logger } = require("../logger");

/**
 *
 * @param object params
 * {
 *  account: Account<Object>,
 *  sourceNodeId: <String>,
 *  destinationPath: <String>,
 * }
 */
exports.recursiveDownload = async params => {
  const account = params.account;
  const watcher = params.watcher;
  const sourceNodeId = params.sourceNodeId; // the nodeid to download
  const destinationPath = params.destinationPath; // where on local to download
  const recursive = params.recursive || false;

  logger.info("download step 1");

  if (
    account.sync_enabled == 0 ||
    (account.sync_in_progress == 1 && recursive === false)
  ) {
    return;
  }

  logger.info("download step 2");

  let children = await remote.getChildren({
    account,
    parentNodeId: sourceNodeId,
    maxItems: 150000
  });
  logger.info("download step 3");

  if (!children) {
    return;
  }

  // If the current folder doesnot exists, we will create it.
  if (!fs.existsSync(`${destinationPath}/${watcher.site_name}/documentLibrary`)) {
    mkdirp(`${destinationPath}/${watcher.site_name}/documentLibrary`);
  }

  logger.info("download step 4");

  for (const iterator of children.list.entries) {
    const node = iterator.entry;
    let relevantPath = node.path.name.substring(
      node.path.name.indexOf(`${watcher.site_name}/documentLibrary`)
    );
    let fileRenamed = false; // If a node is renamed on server, we will not run this delete node check immediately
    const currentPath = path.join(destinationPath, relevantPath, node.name);

    logger.info("download step 5");

    // Check if the node is present in the database
    let record = await nodeModel.getOneByNodeId({
      account: account,
      nodeId: node.id
    });
    logger.info("download step 6");

    // Possible cases...
    // Case A: Perhaps the file was RENAMED on server. Delete from local
    // Case B: Check last modified date and download if newer
    // Case C: Perhaps the file was DELETED on local but not on the server.
    // Case D: If not present on local, download...

    // If the record is present
    if (record) {
      // Case A: Perhaps the file was RENAMED on server. Delete from local
      if (record.file_name !== path.basename(currentPath)) {
        logger.info("Deleted renamed (old) path..." + record.file_path);
        // If a node/folder is renamed on server, we will skip the deletion logic in this iteration assuming that the download will take sometime
        fileRenamed = true;
        // Delete the old file/folder from local
        fs.removeSync(record.file_path);

        // Delete the record from the DB
        if (record.is_file === 1) {
          await nodeModel.forceDelete({
            account,
            nodeId: record.node_id
          });
        } else if (record.is_folder === 1) {
          await nodeModel.forceDeleteAllByFileOrFolderPath({
            account,
            path: record.file_path
          });
        }
      } // end Case A

      // Case B: ...check last modified date and download of the file if newer (lets not download any folders)
      // Convert the time to UTC and then get the unixtimestamp.
      else if (
        _base.convertToUTC(node.modifiedAt) > _base.getFileLatestTime(record) &&
        record.file_name === path.basename(currentPath) &&
        record.is_file === 1
      ) {
        logger.info("downloaded since new " + currentPath);
        await _createItemOnLocal({
          watcher,
          node,
          currentPath,
          account
        });
      } // end Case B

      // Case C: Perhaps the file was DELETED on local but not on the server.(will skip if the node was renamed on server)
      else if (
        !fs.existsSync(currentPath) &&
        record.node_id === node.id &&
        record.remote_folder_path === node.path.name && // making sure the file was not moved to another location
        fileRenamed === false
      ) {
        logger.info(
          "deleted on server, because deleted on local" + currentPath
        );
        await remote.deleteServerNode({
          account,
          record
        });
      } // end Case C
    }

    // Case D: If not present on local or if the file is not present on local, download...
    if (!record && fileRenamed === false) {
      logger.info("created" + currentPath);
      await _createItemOnLocal({
        watcher,
        node,
        currentPath,
        account
      });
    }

    if (node.isFolder === true) {
      await exports.recursiveDownload({
        account,
        watcher,
        sourceNodeId: node.id,
        destinationPath,
        recursive: true
      });
    }
    logger.info("download step 7");
  }

  if (children.list.pagination.hasMoreItems === false && recursive === false) {
    logger.info("FINISH DOWNLOADING...");
    // await accountModel.syncComplete(account.id);
    return;
  }
};
/**
 *
 * @param object params
 * {
 *  account: Account<Object>,
 *  syncPath: string,
 *  rootNodeId: string,
 * }
 */
exports.recursiveUpload = async params => {
  const account = params.account;
  const watcher = params.watcher;
  const rootNodeId = params.rootNodeId; // This should be the documentLibrary nodeId

  logger.info("upload step 1");

  if (account.sync_enabled == 0 || account.sync_in_progress == 1) {
    return;
  }

  logger.info("upload step 2");

  // Get the folder path as /var/sync/documentLibrary or /var/sync/documentLibrary/watchedFolder
  let rootFolder = path.join(
    account.sync_path,
    watcher.watch_folder.substring(
      watcher.watch_folder.indexOf(`${watcher.site_name}/documentLibrary`)
    ),
    "**",
    "*"
  );

  logger.info("upload step 3");

  // This function will list all files/folders/sub-folders recursively.
  let localFilePathList = glob.sync(rootFolder);
  var file = fs.createWriteStream(path.resolve(__dirname, '../../logs/array.txt'));
  file.on('error', function (err) { console.log(err) });
  localFilePathList.forEach(function (v) {
    file.write(v + '\n');
  });
  file.end();
  logger.info("upload step 4");

  // Following cases are possible...
  // Case A: File created or renamed on local, upload it
  // Case B: File modified on local, upload it
  // Case C: File deleted on server, delete on local

  for (let filePath of localFilePathList) {
    logger.info("upload step 5");
    let localFileModifiedDate = _base.getFileModifiedTime(filePath);

    // Get the DB record of the filePath
    let record = await nodeModel.getOneByFilePath({
      account: account,
      filePath: filePath
    });

    logger.info("upload step 6");

    // Case A: File created or renamed on local, upload it
    if (!record) {
      logger.info("New file, uploading..." + filePath);
      await remote.upload({
        account,
        watcher,
        filePath,
        rootNodeId
      });
      continue;
    }

    // Case B: File modified on local, upload it
    else if (
      record &&
      localFileModifiedDate > record.last_uploaded_at &&
      localFileModifiedDate > record.last_downloaded_at &&
      Math.abs(localFileModifiedDate - record.last_downloaded_at) > 10 && // only upload if file wasnt downloaded in the last 10 seconds
      record.is_file === 1
    ) {
      logger.info("File modified on local, uploading..." + filePath);
      // Upload the local changes to the server.
      await remote.upload({
        account,
        watcher,
        filePath,
        rootNodeId
      });
      continue;
    }

    // Case C: File deleted on server, delete on local
    else if (
      record &&
      (record.last_uploaded_at > 0 || record.last_downloaded_at > 0)
    ) {
      logger.info("upload step 6-1");

      const isNodeExists = await remote.getNode({
        account,
        nodeId: record.node_id
      });

      // If the node is not found on the server, delete the file on local
      if (!isNodeExists) {
        logger.info(
          "Node not available on server, deleting on local: " + record.file_path + " - " + record.id
        );
        rimraf(record.file_path, () => {
          nodeModel.forceDelete({
            account,
            nodeId: record.node_id
          });
        });
      }

      // OR if the node exists on server but that path of node does not match the one with local file path, then delete it from local (possible the file was moved to a different location)
      if (isNodeExists && isNodeExists.entry.path.name !== record.remote_folder_path) {
        logger.info(
          "Node was moved to some other location, deleting on local: " + record.file_path + " - " + record.id
        );

        rimraf(record.file_path, () => {
          nodeModel.forceDeleteByPath({
            account,
            filePath: record.file_path
          });
        });
      }
    }
    logger.info("upload step 7");
  } // Filelist iteration end
  logger.info("upload step 8");

  // At the end of folder iteration, we will compile a list of old files that were renamed. We will delete those from the server.
  let missingFiles = await nodeModel.getMissingFiles({
    account,
    watcher,
    fileList: localFilePathList
  });
  logger.info("upload step 9");
  logger.info(`Deleting ${missingFiles.length} missing files...`);
  for (const record of missingFiles) {
    logger.info(`Deleting ${record.file_patj}`);
    remote.deleteServerNode({
      account,
      record
    });
  }
  logger.info("upload step 10");
  localFilePathList = [];
  missingFiles = null;

  logger.info("FINISHED UPLOAD...");
  return;
};

/**
 * Recursively delete all files from server that were deleted from local
 *
 * @param object params
 * {
 *  account: Account<Object>,
 * }
 */
exports.recursiveDelete = async params => {
  return;
  let account = params.account;

  if (account.sync_enabled == 0) {
    return;
  }

  // Start the sync
  await accountModel.syncStart(account.id);

  // This function will list all files/folders/sub-folders recursively.
  let localFilePathList = glob.sync(path.join(account.sync_path, "**", "*"));

  let missingFiles = await nodeModel.getMissingFiles({
    account: account,
    fileList: localFilePathList
  });

  for (const iterator of missingFiles) {
    // Delete the node from the server, once thats done it will delete the record from the DB as well
    await remote.deleteServerNode({
      account: account,
      deletedNodeId: iterator.node_id
    });
    logger.info(`Deleted missing file: ${iterator.stringify()}`);
  }

  // Set the sync completed time and also set issync flag to off
  await accountModel.syncComplete(account.id);
};

/**
 *
 * @param object params
 * {
 *  account: Account<Object>,
 *  filePath: string,
 * }
 */
exports.deleteByPath = async params => {
  let account = params.account;
  let filePath = params.filePath;

  if (
    account.sync_enabled == 0 ||
    (await remote.watchFolderGuard({ account, filePath })) === false
  ) {
    return;
  }

  try {
    // Start the sync
    await accountModel.syncStart(account.id);

    let records = await nodeModel.getAllByFileOrFolderPath({
      account: account,
      path: filePath
    });

    for (let record of records) {
      // Delete the node from the server, once thats done it will delete the record from the DB as well
      await remote.deleteServerNode({
        account: account,
        record: record
      });
    }
    // Set the sync completed time and also set issync flag to off
    await accountModel.syncComplete(account.id);
  } catch (error) {
    logger.error(`Error Message : ${JSON.stringify(error)}`);
    await errorLogModel.add(account.id, error);
    // Set the sync completed time and also set issync flag to off
    await accountModel.syncComplete(account.id);
  }
};

_createItemOnLocal = async params => {
  const account = params.account;
  const watcher = params.watcher;
  const node = params.node;
  const currentPath = params.currentPath;
  try {
    if (node.isFolder === true) {
      // If the child is a folder, create the folder first
      if (!fs.existsSync(currentPath)) {
        mkdirp.sync(currentPath);
      }

      // Add reference to the nodes table
      await nodeModel.add({
        account,
        watcher,
        nodeId: node.id,
        remoteFolderPath: node.path.name,
        filePath: currentPath,
        fileUpdateAt: _base.convertToUTC(node.modifiedAt),
        lastDownloadedAt: _base.getCurrentTime(),
        isFolder: true,
        isFile: false
      });
    }

    // If the child is a file, download the file...
    if (node.isFile === true) {
      await remote.download({
        watcher,
        account,
        node,
        destinationPath: currentPath,
        remoteFolderPath: node.path.name
      });
    }
  } catch (error) {
    logger.error(`Error Message : ${JSON.stringify(error)}`);
    await errorLogModel.add(account.id, error);
  }
};

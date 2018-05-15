const watch = require("watch");
const fs = require("fs");

// Add a new watcher
exports.watch = path => {
  let watchlist = [];
  watch.watchTree(path, function(f, curr, prev) {
    if (typeof f == "object" && prev === null && curr === null) {
      // Finished walking the tree
      console.log("Finished walking the tree");
    } else if (prev === null) {
      // f is a new file
      if (watchlist.indexOf(f) == -1) {
        let type = "file";
        if (fs.lstatSync(f).isDirectory()) {
          type = "directory";
        }

        console.log(f + " is a new " + type);
      }

      watchlist.push(f);
    } else if (curr.nlink === 0) {
      // f was removed
      if (watchlist.indexOf(f) == -1) {
        console.log(f + " was removed");
      }
      watchlist.push(f);
    } else {
      // f was changed
      if (watchlist.indexOf(f) == -1) {
        console.log(f + " was changed");
      }
      watchlist.push(f);
    }
  });

  setInterval(() => {
    watchlist = [];
  }, 1500);

  // return response.status(200).json({ a: 1 });
};

// remove a watchlist
exports.remove = path => {
  watch.unwatchTree(path);

  // return response.status(200).json({ a: 1 });
};

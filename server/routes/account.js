const express = require("express");
const router = express.Router();

// Middlewares
const accountAddMiddleware = require("../middlewares/accounts/add");
const accountUpdateSyncMiddleware = require("../middlewares/accounts/update");

// Controllers
const accountController = require("../controllers/account");

router.get("/", accountController.getAll);
router.get("/:id", accountController.getOne);
router.post("/", accountAddMiddleware, accountController.addAccount);
router.put("/:id", accountAddMiddleware, accountController.updateAccount);
router.put("/:id/sync", accountUpdateSyncMiddleware, accountController.updateSync);
router.put("/:id/synctime", accountController.updateSyncTime);
router.delete("/:id", accountController.deleteAccount);

module.exports = router;

const express = require("express");
const authController = require("../controllers/auth.controller");
const { loginLimiter, signupLimiter } = require("../middleware/rate-limit");

const router = express.Router();

router.get("/signup", authController.showSignup);
router.post("/signup", signupLimiter, authController.signup);
router.get("/login", authController.showLogin);
router.post("/login", loginLimiter, authController.login);
router.post("/logout", authController.logout);

module.exports = router;

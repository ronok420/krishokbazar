// src/routes/auth.js
const router = require('express').Router();
const { register, login, getMe, updateMe, getFarmers, getFarmer, getNearbyUsers } = require('../controllers/authController');
const { protect } = require('../middleware/auth');

router.post('/register',      register);
router.post('/login',         login);
router.get ('/me',            protect, getMe);
router.patch('/me',           protect, updateMe);
router.get ('/nearby',        protect, getNearbyUsers);
router.get ('/farmers',       getFarmers);
router.get ('/farmers/:id',   getFarmer);

module.exports = router;

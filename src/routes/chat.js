// src/routes/chat.js
const router = require('express').Router();
const ctrl   = require('../controllers/chatController');
const { protect } = require('../middleware/auth');

router.get ('/',                protect, ctrl.getConversations);
router.post('/start',           protect, ctrl.startConversation);
router.get ('/:id/messages',    protect, ctrl.getMessages);
router.post('/:id/messages',    protect, ctrl.sendMessage);

module.exports = router;

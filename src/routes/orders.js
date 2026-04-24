// src/routes/orders.js
const router = require('express').Router();
const ctrl   = require('../controllers/orderController');
const { protect, farmerOnly, buyerOnly } = require('../middleware/auth');

router.post('/',               protect, buyerOnly,  ctrl.placeOrder);
router.get ('/',               protect, buyerOnly,  ctrl.myOrders);
router.get ('/incoming',       protect, farmerOnly, ctrl.incomingOrders);
router.get ('/:id',            protect,             ctrl.getOrder);
router.patch('/:id/status',    protect, farmerOnly, ctrl.updateStatus);
router.post('/:id/bargain',    protect, buyerOnly,  ctrl.bargain);

module.exports = router;

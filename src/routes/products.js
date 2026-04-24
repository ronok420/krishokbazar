// src/routes/products.js
const router = require('express').Router();
const ctrl   = require('../controllers/productController');
const { protect, farmerOnly } = require('../middleware/auth');
const upload = require('../middleware/upload');

router.get ('/',                ctrl.getProducts);
router.post('/',                protect, farmerOnly, upload.single('image'), ctrl.createProduct);
router.get ('/mine',            protect, farmerOnly, ctrl.myProducts);
router.get ('/categories',      ctrl.getCategories);
router.get ('/:id',             ctrl.getProduct);
router.patch('/:id',            protect, farmerOnly, upload.single('image'), ctrl.updateProduct);
router.delete('/:id',           protect, farmerOnly, ctrl.deleteProduct);
router.post('/:id/review',      protect, ctrl.addReview);
router.get ('/:id/reviews',     ctrl.getReviews);

module.exports = router;

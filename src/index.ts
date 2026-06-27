import { Router, json } from './router';
import { listProducts, getProduct, createProduct, updateProduct, deleteProduct } from './handlers/products';
import { listReviews, createReview } from './handlers/reviews';
import { listOrders, getOrder, createOrder, updateOrderStatus } from './handlers/orders';
import { renderLanding } from './pages/landing';

const router = new Router();

// Landing page
router.get('/', async (_req, env) => {
	const html = await renderLanding(env);
	return new Response(html, { headers: { 'Content-Type': 'text/html' } });
});

// Products
router.get('/api/products', (req, env) => listProducts(req, env));
router.get('/api/products/:slug', (req, env, p) => getProduct(req, env, p));
router.post('/api/products', (req, env) => createProduct(req, env));
router.put('/api/products/:slug', (req, env, p) => updateProduct(req, env, p));
router.delete('/api/products/:slug', (req, env, p) => deleteProduct(req, env, p));

// Reviews
router.get('/api/products/:slug/reviews', (req, env, p) => listReviews(req, env, p));
router.post('/api/products/:slug/reviews', (req, env, p) => createReview(req, env, p));

// Orders
router.get('/api/orders', (req, env) => listOrders(req, env));
router.get('/api/orders/:id', (req, env, p) => getOrder(req, env, p));
router.post('/api/orders', (req, env) => createOrder(req, env));
router.put('/api/orders/:id/status', (req, env, p) => updateOrderStatus(req, env, p));

// CORS preflight
router.on('OPTIONS', '/(.*)', async () =>
	json(null, 204, {
		'Access-Control-Max-Age': '86400',
	})
);

export default {
	async fetch(request, env) {
		return router.handle(request, env);
	},
} satisfies ExportedHandler<Env>;

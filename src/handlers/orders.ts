import { json } from '../router';

export async function listOrders(request: Request, env: Env) {
	const url = new URL(request.url);
	const status = url.searchParams.get('status');
	const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 50);
	const offset = parseInt(url.searchParams.get('offset') || '0');

	let query = 'SELECT * FROM orders';
	const bindings: unknown[] = [];

	if (status) {
		query += ' WHERE status = ?';
		bindings.push(status);
	}

	query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
	bindings.push(limit, offset);

	const { results } = await env.DB.prepare(query).bind(...bindings).all();

	const ordersWithItems = await Promise.all(
		results.map(async (order) => {
			const { results: items } = await env.DB.prepare(`
				SELECT oi.*, p.name as product_name, p.slug as product_slug
				FROM order_items oi
				JOIN products p ON p.id = oi.product_id
				WHERE oi.order_id = ?
			`).bind(order.id).all();

			return {
				...order,
				total_formatted: `$${((order.total as number) / 100).toFixed(2)}`,
				items: items.map(item => ({
					...item,
					price_formatted: `$${((item.price as number) / 100).toFixed(2)}`,
				})),
			};
		})
	);

	return json({ orders: ordersWithItems, limit, offset });
}

export async function getOrder(_request: Request, env: Env, params: Record<string, string>) {
	const { id } = params;
	const order = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(id).first();
	if (!order) return json({ error: 'Order not found' }, 404);

	const { results: items } = await env.DB.prepare(`
		SELECT oi.*, p.name as product_name, p.slug as product_slug
		FROM order_items oi
		JOIN products p ON p.id = oi.product_id
		WHERE oi.order_id = ?
	`).bind(order.id).all();

	return json({
		...order,
		total_formatted: `$${((order.total as number) / 100).toFixed(2)}`,
		items: items.map(item => ({
			...item,
			price_formatted: `$${((item.price as number) / 100).toFixed(2)}`,
		})),
	});
}

export async function createOrder(request: Request, env: Env) {
	const body = await request.json() as Record<string, unknown>;
	const required = ['customer_name', 'customer_email', 'shipping_address', 'city', 'state', 'zip', 'items'];
	for (const field of required) {
		if (!body[field]) return json({ error: `Missing required field: ${field}` }, 400);
	}

	const items = body.items as Array<{ product_id: number; quantity: number }>;
	if (!Array.isArray(items) || items.length === 0) {
		return json({ error: 'Order must contain at least one item' }, 400);
	}

	const productIds = items.map(i => i.product_id);
	const placeholders = productIds.map(() => '?').join(',');
	const { results: products } = await env.DB.prepare(
		`SELECT id, price, in_stock FROM products WHERE id IN (${placeholders})`
	).bind(...productIds).all();

	const productMap = new Map(products.map(p => [p.id, p]));

	for (const item of items) {
		const product = productMap.get(item.product_id);
		if (!product) return json({ error: `Product ${item.product_id} not found` }, 400);
		if (!product.in_stock) return json({ error: `Product ${item.product_id} is out of stock` }, 400);
	}

	let total = 0;
	for (const item of items) {
		const product = productMap.get(item.product_id)!;
		total += (product.price as number) * (item.quantity || 1);
	}

	const orderResult = await env.DB.prepare(`
		INSERT INTO orders (customer_name, customer_email, shipping_address, city, state, zip, total)
		VALUES (?, ?, ?, ?, ?, ?, ?)
	`).bind(
		body.customer_name, body.customer_email, body.shipping_address,
		body.city, body.state, body.zip, total
	).run();

	const orderId = orderResult.meta.last_row_id;

	const insertStmt = env.DB.prepare(
		'INSERT INTO order_items (order_id, product_id, quantity, price) VALUES (?, ?, ?, ?)'
	);

	await env.DB.batch(
		items.map(item => {
			const product = productMap.get(item.product_id)!;
			return insertStmt.bind(orderId, item.product_id, item.quantity || 1, product.price);
		})
	);

	return json({
		id: orderId,
		status: 'pending',
		total,
		total_formatted: `$${(total / 100).toFixed(2)}`,
		items_count: items.length,
	}, 201);
}

export async function updateOrderStatus(request: Request, env: Env, params: Record<string, string>) {
	const { id } = params;
	const body = await request.json() as Record<string, unknown>;
	const validStatuses = ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled'];

	if (!body.status || !validStatuses.includes(body.status as string)) {
		return json({ error: `Status must be one of: ${validStatuses.join(', ')}` }, 400);
	}

	const result = await env.DB.prepare('UPDATE orders SET status = ? WHERE id = ?')
		.bind(body.status, id).run();

	if (result.meta.changes === 0) return json({ error: 'Order not found' }, 404);

	return json({ id: Number(id), status: body.status });
}

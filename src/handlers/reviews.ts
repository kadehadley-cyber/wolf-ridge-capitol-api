import { json } from '../router';

export async function listReviews(request: Request, env: Env, params: Record<string, string>) {
	const { slug } = params;
	const product = await env.DB.prepare('SELECT id FROM products WHERE slug = ?').bind(slug).first();
	if (!product) return json({ error: 'Product not found' }, 404);

	const url = new URL(request.url);
	const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 50);
	const offset = parseInt(url.searchParams.get('offset') || '0');

	const { results } = await env.DB.prepare(
		'SELECT id, author, rating, title, content, verified_purchase, created_at FROM reviews WHERE product_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
	).bind(product.id, limit, offset).all();

	const stats = await env.DB.prepare(
		'SELECT COUNT(*) as count, AVG(rating) as average FROM reviews WHERE product_id = ?'
	).bind(product.id).first();

	return json({
		reviews: results.map(r => ({ ...r, verified_purchase: !!r.verified_purchase })),
		stats: {
			count: (stats as Record<string, unknown>)?.count || 0,
			average: Math.round(((stats as Record<string, unknown>)?.average as number || 0) * 10) / 10,
		},
		limit,
		offset,
	});
}

export async function createReview(request: Request, env: Env, params: Record<string, string>) {
	const { slug } = params;
	const product = await env.DB.prepare('SELECT id FROM products WHERE slug = ?').bind(slug).first();
	if (!product) return json({ error: 'Product not found' }, 404);

	const body = await request.json() as Record<string, unknown>;

	if (!body.author || !body.content || !body.rating) {
		return json({ error: 'Missing required fields: author, content, rating' }, 400);
	}

	const rating = Number(body.rating);
	if (rating < 1 || rating > 5 || !Number.isInteger(rating)) {
		return json({ error: 'Rating must be an integer between 1 and 5' }, 400);
	}

	const result = await env.DB.prepare(`
		INSERT INTO reviews (product_id, author, email, rating, title, content, verified_purchase)
		VALUES (?, ?, ?, ?, ?, ?, ?)
	`).bind(
		product.id, body.author, body.email || null,
		rating, body.title || null, body.content,
		body.verified_purchase ? 1 : 0
	).run();

	return json({
		id: result.meta.last_row_id,
		product_slug: slug,
		author: body.author,
		rating,
		title: body.title || null,
		content: body.content,
	}, 201);
}

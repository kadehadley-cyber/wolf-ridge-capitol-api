import { json } from '../router';

export async function listProducts(request: Request, env: Env) {
	const url = new URL(request.url);
	const category = url.searchParams.get('category');
	const featured = url.searchParams.get('featured');
	const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 100);
	const offset = parseInt(url.searchParams.get('offset') || '0');

	let query = 'SELECT * FROM products WHERE 1=1';
	const bindings: unknown[] = [];

	if (category) {
		query += ' AND category = ?';
		bindings.push(category);
	}
	if (featured === 'true') {
		query += ' AND is_featured = 1';
	}

	query += ' ORDER BY is_featured DESC, created_at DESC LIMIT ? OFFSET ?';
	bindings.push(limit, offset);

	const { results } = await env.DB.prepare(query).bind(...bindings).all();
	const countQuery = 'SELECT COUNT(*) as total FROM products';
	const { results: countResults } = await env.DB.prepare(countQuery).all();

	return json({
		products: results.map(formatProduct),
		total: (countResults[0] as { total: number }).total,
		limit,
		offset,
	});
}

export async function getProduct(_request: Request, env: Env, params: Record<string, string>) {
	const { slug } = params;
	const product = await env.DB.prepare('SELECT * FROM products WHERE slug = ?').bind(slug).first();

	if (!product) return json({ error: 'Product not found' }, 404);

	const { results: reviews } = await env.DB.prepare(
		'SELECT * FROM reviews WHERE product_id = ? ORDER BY created_at DESC LIMIT 10'
	).bind(product.id).all();

	const stats = await env.DB.prepare(
		'SELECT COUNT(*) as count, AVG(rating) as average FROM reviews WHERE product_id = ?'
	).bind(product.id).first();

	return json({
		...formatProduct(product),
		reviews: reviews.map(formatReview),
		review_stats: {
			count: (stats as Record<string, unknown>)?.count || 0,
			average: Math.round(((stats as Record<string, unknown>)?.average as number || 0) * 10) / 10,
		},
	});
}

export async function createProduct(request: Request, env: Env) {
	const body = await request.json() as Record<string, unknown>;
	const required = ['name', 'slug', 'description', 'price'];
	for (const field of required) {
		if (!body[field]) return json({ error: `Missing required field: ${field}` }, 400);
	}

	const result = await env.DB.prepare(`
		INSERT INTO products (name, slug, description, short_description, price, compare_at_price, category, ingredients, benefits, size, image_url, is_featured)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`).bind(
		body.name, body.slug, body.description, body.short_description || null,
		body.price, body.compare_at_price || null, body.category || 'skincare',
		body.ingredients || null, body.benefits || null, body.size || null,
		body.image_url || null, body.is_featured ? 1 : 0
	).run();

	return json({ id: result.meta.last_row_id, ...body }, 201);
}

export async function updateProduct(request: Request, env: Env, params: Record<string, string>) {
	const { slug } = params;
	const existing = await env.DB.prepare('SELECT id FROM products WHERE slug = ?').bind(slug).first();
	if (!existing) return json({ error: 'Product not found' }, 404);

	const body = await request.json() as Record<string, unknown>;
	const fields: string[] = [];
	const values: unknown[] = [];

	const allowed = ['name', 'slug', 'description', 'short_description', 'price', 'compare_at_price', 'category', 'ingredients', 'benefits', 'size', 'image_url', 'is_featured', 'in_stock'];
	for (const field of allowed) {
		if (body[field] !== undefined) {
			fields.push(`${field} = ?`);
			values.push(body[field]);
		}
	}

	if (fields.length === 0) return json({ error: 'No fields to update' }, 400);

	values.push(existing.id);
	await env.DB.prepare(`UPDATE products SET ${fields.join(', ')} WHERE id = ?`).bind(...values).run();

	const updated = await env.DB.prepare('SELECT * FROM products WHERE id = ?').bind(existing.id).first();
	return json(formatProduct(updated!));
}

export async function deleteProduct(_request: Request, env: Env, params: Record<string, string>) {
	const { slug } = params;
	const result = await env.DB.prepare('DELETE FROM products WHERE slug = ?').bind(slug).run();
	if (result.meta.changes === 0) return json({ error: 'Product not found' }, 404);
	return json({ deleted: true });
}

function formatProduct(row: Record<string, unknown>) {
	return {
		...row,
		price_formatted: `$${((row.price as number) / 100).toFixed(2)}`,
		compare_at_price_formatted: row.compare_at_price
			? `$${((row.compare_at_price as number) / 100).toFixed(2)}`
			: null,
		ingredients_list: row.ingredients ? (row.ingredients as string).split(', ') : [],
		benefits_list: row.benefits ? (row.benefits as string).split(', ') : [],
	};
}

function formatReview(row: Record<string, unknown>) {
	return {
		id: row.id,
		author: row.author,
		rating: row.rating,
		title: row.title,
		content: row.content,
		verified_purchase: !!row.verified_purchase,
		created_at: row.created_at,
	};
}

export async function renderLanding(env: Env): Promise<string> {
	const { results } = await env.DB.prepare(
		'SELECT * FROM products WHERE is_featured = 1 ORDER BY created_at DESC LIMIT 4'
	).all();

	const productCards = results.map((p) => {
		const price = `$${((p.price as number) / 100).toFixed(2)}`;
		const comparePrice = p.compare_at_price
			? `<span class="compare-price">$${((p.compare_at_price as number) / 100).toFixed(2)}</span>`
			: '';
		const badge = p.compare_at_price ? '<span class="badge">Sale</span>' : '';

		return `
			<div class="product-card">
				${badge}
				<div class="product-image">
					<div class="product-icon">${getCategoryIcon(p.category as string)}</div>
				</div>
				<h3>${p.name}</h3>
				<p class="product-desc">${p.short_description}</p>
				<div class="product-price">
					<span class="price">${price}</span>
					${comparePrice}
				</div>
				<a href="/api/products/${p.slug}" class="btn btn-outline">View Details</a>
			</div>`;
	}).join('');

	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>EXOSOME | Advanced Facial Cream</title>
	<style>
		*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

		:root {
			--gold: #c4a35a;
			--gold-light: #d4b96a;
			--cream: #faf8f4;
			--dark: #1a1a1a;
			--text: #2d2d2d;
			--text-light: #6b6b6b;
			--white: #ffffff;
			--border: #e8e4dc;
		}

		body {
			font-family: -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;
			color: var(--text);
			background: var(--white);
			line-height: 1.6;
			-webkit-font-smoothing: antialiased;
		}

		/* Nav */
		nav {
			position: fixed; top: 0; width: 100%; z-index: 100;
			background: rgba(255,255,255,0.95);
			backdrop-filter: blur(20px);
			border-bottom: 1px solid var(--border);
			padding: 0 2rem;
		}
		.nav-inner {
			max-width: 1200px; margin: 0 auto;
			display: flex; align-items: center; justify-content: space-between;
			height: 72px;
		}
		.logo {
			font-size: 1.5rem; font-weight: 700; letter-spacing: 0.3em;
			color: var(--dark); text-decoration: none;
		}
		.logo span { color: var(--gold); }
		.nav-links { display: flex; gap: 2rem; list-style: none; }
		.nav-links a {
			text-decoration: none; color: var(--text-light);
			font-size: 0.85rem; letter-spacing: 0.1em; text-transform: uppercase;
			transition: color 0.2s;
		}
		.nav-links a:hover { color: var(--gold); }

		/* Hero */
		.hero {
			min-height: 100vh;
			display: flex; align-items: center; justify-content: center;
			background: linear-gradient(135deg, #1a1a1a 0%, #2d2926 50%, #3d3530 100%);
			text-align: center; padding: 6rem 2rem 4rem;
			position: relative; overflow: hidden;
		}
		.hero::before {
			content: ''; position: absolute; inset: 0;
			background: radial-gradient(ellipse at 30% 50%, rgba(196,163,90,0.15) 0%, transparent 60%),
			            radial-gradient(ellipse at 70% 50%, rgba(196,163,90,0.1) 0%, transparent 60%);
		}
		.hero-content { position: relative; z-index: 1; max-width: 700px; }
		.hero-badge {
			display: inline-block; padding: 0.4rem 1.2rem;
			border: 1px solid rgba(196,163,90,0.4);
			border-radius: 100px; color: var(--gold);
			font-size: 0.75rem; letter-spacing: 0.2em; text-transform: uppercase;
			margin-bottom: 2rem;
		}
		.hero h1 {
			font-size: clamp(2.5rem, 6vw, 4.5rem);
			font-weight: 300; color: var(--white);
			line-height: 1.1; margin-bottom: 1.5rem;
			letter-spacing: -0.02em;
		}
		.hero h1 strong { font-weight: 700; color: var(--gold); }
		.hero p {
			font-size: 1.15rem; color: rgba(255,255,255,0.7);
			max-width: 520px; margin: 0 auto 2.5rem; line-height: 1.7;
		}

		/* Buttons */
		.btn {
			display: inline-block; padding: 0.9rem 2.5rem;
			text-decoration: none; font-size: 0.85rem;
			letter-spacing: 0.15em; text-transform: uppercase;
			border-radius: 4px; transition: all 0.3s; cursor: pointer;
			font-weight: 600;
		}
		.btn-primary {
			background: var(--gold); color: var(--dark); border: none;
		}
		.btn-primary:hover { background: var(--gold-light); transform: translateY(-1px); }
		.btn-secondary {
			background: transparent; color: var(--white);
			border: 1px solid rgba(255,255,255,0.3); margin-left: 1rem;
		}
		.btn-secondary:hover { border-color: var(--gold); color: var(--gold); }
		.btn-outline {
			background: transparent; color: var(--gold);
			border: 1px solid var(--gold); width: 100%;
			text-align: center; margin-top: auto;
		}
		.btn-outline:hover { background: var(--gold); color: var(--white); }

		/* Science section */
		.section { padding: 6rem 2rem; }
		.section-inner { max-width: 1200px; margin: 0 auto; }
		.section-header {
			text-align: center; margin-bottom: 4rem;
		}
		.section-header .label {
			color: var(--gold); font-size: 0.75rem;
			letter-spacing: 0.2em; text-transform: uppercase;
			margin-bottom: 1rem; display: block;
		}
		.section-header h2 {
			font-size: 2.5rem; font-weight: 300;
			letter-spacing: -0.02em;
		}
		.section-header h2 strong { font-weight: 700; }
		.section-header p {
			color: var(--text-light); max-width: 600px;
			margin: 1rem auto 0; font-size: 1.05rem;
		}

		.science-bg { background: var(--cream); }

		.features-grid {
			display: grid;
			grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
			gap: 2rem;
		}
		.feature {
			background: var(--white); padding: 2.5rem;
			border-radius: 12px; border: 1px solid var(--border);
			transition: transform 0.2s, box-shadow 0.2s;
		}
		.feature:hover {
			transform: translateY(-4px);
			box-shadow: 0 12px 40px rgba(0,0,0,0.06);
		}
		.feature-icon {
			width: 52px; height: 52px;
			background: linear-gradient(135deg, var(--gold), var(--gold-light));
			border-radius: 12px;
			display: flex; align-items: center; justify-content: center;
			font-size: 1.4rem; margin-bottom: 1.5rem;
		}
		.feature h3 { font-size: 1.15rem; margin-bottom: 0.75rem; }
		.feature p { color: var(--text-light); font-size: 0.95rem; line-height: 1.6; }

		/* Products */
		.products-grid {
			display: grid;
			grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
			gap: 2rem;
		}
		.product-card {
			background: var(--white); border: 1px solid var(--border);
			border-radius: 12px; padding: 2rem;
			display: flex; flex-direction: column;
			transition: transform 0.2s, box-shadow 0.2s;
			position: relative;
		}
		.product-card:hover {
			transform: translateY(-4px);
			box-shadow: 0 12px 40px rgba(0,0,0,0.08);
		}
		.product-image {
			background: var(--cream); border-radius: 8px;
			height: 200px; display: flex; align-items: center;
			justify-content: center; margin-bottom: 1.5rem;
		}
		.product-icon { font-size: 3.5rem; }
		.product-card h3 { font-size: 1.1rem; margin-bottom: 0.5rem; }
		.product-desc {
			color: var(--text-light); font-size: 0.9rem;
			margin-bottom: 1rem; flex-grow: 1;
		}
		.product-price { margin-bottom: 1rem; }
		.price { font-size: 1.3rem; font-weight: 700; color: var(--dark); }
		.compare-price {
			font-size: 0.95rem; color: var(--text-light);
			text-decoration: line-through; margin-left: 0.5rem;
		}
		.badge {
			position: absolute; top: 1rem; right: 1rem;
			background: var(--gold); color: var(--white);
			font-size: 0.7rem; padding: 0.25rem 0.75rem;
			border-radius: 100px; letter-spacing: 0.1em;
			text-transform: uppercase; font-weight: 600;
		}

		/* API section */
		.api-section { background: var(--dark); color: var(--white); }
		.api-grid {
			display: grid;
			grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
			gap: 1rem;
		}
		.api-endpoint {
			background: rgba(255,255,255,0.05);
			border: 1px solid rgba(255,255,255,0.1);
			border-radius: 8px; padding: 1.5rem;
			font-family: 'SF Mono', 'Fira Code', monospace;
		}
		.api-method {
			font-size: 0.7rem; font-weight: 700;
			letter-spacing: 0.1em; padding: 0.2rem 0.6rem;
			border-radius: 4px; margin-right: 0.5rem;
		}
		.api-method.get { background: #10b981; color: #fff; }
		.api-method.post { background: #3b82f6; color: #fff; }
		.api-method.put { background: #f59e0b; color: #fff; }
		.api-method.delete { background: #ef4444; color: #fff; }
		.api-path { color: rgba(255,255,255,0.8); font-size: 0.9rem; }
		.api-desc {
			color: rgba(255,255,255,0.5); font-size: 0.8rem;
			margin-top: 0.5rem; font-family: -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;
		}

		/* Footer */
		footer {
			background: var(--dark); color: rgba(255,255,255,0.5);
			padding: 3rem 2rem; text-align: center;
			border-top: 1px solid rgba(255,255,255,0.1);
			font-size: 0.85rem;
		}
		footer .logo { color: var(--white); font-size: 1.2rem; margin-bottom: 1rem; display: block; }

		@media (max-width: 768px) {
			.nav-links { display: none; }
			.hero { padding: 5rem 1.5rem 3rem; }
			.btn-secondary { margin: 1rem 0 0; }
			.section { padding: 4rem 1.5rem; }
		}
	</style>
</head>
<body>
	<nav>
		<div class="nav-inner">
			<a href="/" class="logo">EXO<span>SOME</span></a>
			<ul class="nav-links">
				<li><a href="#science">Science</a></li>
				<li><a href="#products">Products</a></li>
				<li><a href="#api">API</a></li>
			</ul>
		</div>
	</nav>

	<section class="hero">
		<div class="hero-content">
			<span class="hero-badge">Cellular Biotechnology</span>
			<h1>The Future of Skin is <strong>Exosome</strong></h1>
			<p>Harnessing plant-derived exosome technology to deliver active ingredients at the cellular level. Science-backed skincare that transforms from within.</p>
			<div>
				<a href="#products" class="btn btn-primary">Shop Collection</a>
				<a href="#science" class="btn btn-secondary">The Science</a>
			</div>
		</div>
	</section>

	<section class="section science-bg" id="science">
		<div class="section-inner">
			<div class="section-header">
				<span class="label">The Science</span>
				<h2>Why <strong>Exosomes</strong>?</h2>
				<p>Exosomes are nanoscale vesicles that carry bioactive molecules directly into skin cells, bypassing the barriers that stop traditional ingredients.</p>
			</div>
			<div class="features-grid">
				<div class="feature">
					<div class="feature-icon">&#x1F52C;</div>
					<h3>Nano-Scale Delivery</h3>
					<p>At 30-150nm, exosomes penetrate the skin barrier to deliver actives directly where cells need them most.</p>
				</div>
				<div class="feature">
					<div class="feature-icon">&#x1F9EC;</div>
					<h3>Cellular Communication</h3>
					<p>Exosomes carry growth factors and signaling molecules that trigger your skin's natural repair and renewal pathways.</p>
				</div>
				<div class="feature">
					<div class="feature-icon">&#x1F331;</div>
					<h3>Plant-Derived</h3>
					<p>Our exosomes are ethically sourced from botanical stem cells, ensuring purity and biocompatibility with human skin.</p>
				</div>
				<div class="feature">
					<div class="feature-icon">&#x2696;&#xFE0F;</div>
					<h3>Clinically Tested</h3>
					<p>Every formula undergoes rigorous testing. 94% of participants saw visible improvement in skin texture within 4 weeks.</p>
				</div>
			</div>
		</div>
	</section>

	<section class="section" id="products">
		<div class="section-inner">
			<div class="section-header">
				<span class="label">The Collection</span>
				<h2>Featured <strong>Products</strong></h2>
				<p>Each product in our line is formulated with our proprietary exosome complex for maximum efficacy.</p>
			</div>
			<div class="products-grid">
				${productCards}
			</div>
		</div>
	</section>

	<section class="section api-section" id="api">
		<div class="section-inner">
			<div class="section-header">
				<span class="label">For Developers</span>
				<h2 style="color: var(--white);">REST <strong style="color: var(--gold);">API</strong></h2>
				<p style="color: rgba(255,255,255,0.6);">Full programmatic access to our product catalog, reviews, and order management.</p>
			</div>
			<div class="api-grid">
				<div class="api-endpoint">
					<span class="api-method get">GET</span>
					<span class="api-path">/api/products</span>
					<div class="api-desc">List all products with filtering</div>
				</div>
				<div class="api-endpoint">
					<span class="api-method get">GET</span>
					<span class="api-path">/api/products/:slug</span>
					<div class="api-desc">Get product details with reviews</div>
				</div>
				<div class="api-endpoint">
					<span class="api-method post">POST</span>
					<span class="api-path">/api/products</span>
					<div class="api-desc">Create a new product</div>
				</div>
				<div class="api-endpoint">
					<span class="api-method put">PUT</span>
					<span class="api-path">/api/products/:slug</span>
					<div class="api-desc">Update a product</div>
				</div>
				<div class="api-endpoint">
					<span class="api-method post">POST</span>
					<span class="api-path">/api/products/:slug/reviews</span>
					<div class="api-desc">Submit a product review</div>
				</div>
				<div class="api-endpoint">
					<span class="api-method get">GET</span>
					<span class="api-path">/api/products/:slug/reviews</span>
					<div class="api-desc">List reviews for a product</div>
				</div>
				<div class="api-endpoint">
					<span class="api-method post">POST</span>
					<span class="api-path">/api/orders</span>
					<div class="api-desc">Place a new order</div>
				</div>
				<div class="api-endpoint">
					<span class="api-method get">GET</span>
					<span class="api-path">/api/orders/:id</span>
					<div class="api-desc">Get order details</div>
				</div>
			</div>
		</div>
	</section>

	<footer>
		<a href="/" class="logo">EXO<span>SOME</span></a>
		<p>Powered by Cloudflare Workers + D1 &mdash; Wolf Ridge Capitol</p>
	</footer>
</body>
</html>`;
}

function getCategoryIcon(category: string): string {
	const icons: Record<string, string> = {
		moisturizers: '&#x1F9F4;',
		serums: '&#x1F4A7;',
		masks: '&#x1F31C;',
		cleansers: '&#x1FAE7;',
		sets: '&#x1F381;',
	};
	return icons[category] || '&#x2728;';
}

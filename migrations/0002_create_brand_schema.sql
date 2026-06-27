-- Migration number: 0002    2026-06-27 - Exosome Facial Cream brand schema

CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL,
    short_description TEXT,
    price INTEGER NOT NULL,
    compare_at_price INTEGER,
    category TEXT NOT NULL DEFAULT 'skincare',
    ingredients TEXT,
    benefits TEXT,
    size TEXT,
    image_url TEXT,
    is_featured INTEGER NOT NULL DEFAULT 0,
    in_stock INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    author TEXT NOT NULL,
    email TEXT,
    rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
    title TEXT,
    content TEXT NOT NULL,
    verified_purchase INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_name TEXT NOT NULL,
    customer_email TEXT NOT NULL,
    shipping_address TEXT NOT NULL,
    city TEXT NOT NULL,
    state TEXT NOT NULL,
    zip TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    total INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    price INTEGER NOT NULL,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

CREATE INDEX idx_reviews_product ON reviews(product_id);
CREATE INDEX idx_order_items_order ON order_items(order_id);
CREATE INDEX idx_products_slug ON products(slug);
CREATE INDEX idx_products_category ON products(category);
CREATE INDEX idx_orders_status ON orders(status);

-- Seed product catalog
INSERT INTO products (name, slug, description, short_description, price, compare_at_price, category, ingredients, benefits, size, is_featured) VALUES
    ('Exosome Rejuvenation Cream', 'exosome-rejuvenation-cream',
     'Our signature exosome-infused facial cream harnesses cutting-edge biotechnology to deliver cellular-level rejuvenation. Plant-derived exosomes penetrate deep into the skin barrier, promoting collagen synthesis and accelerating cell turnover for visibly younger, firmer skin.',
     'Signature exosome-infused cream for deep cellular rejuvenation.',
     12900, 15900, 'moisturizers',
     'Plant-Derived Exosomes, Hyaluronic Acid, Niacinamide, Peptide Complex, Squalane, Ceramide NP, Vitamin E, Aloe Vera Extract, Green Tea Extract, Jojoba Oil',
     'Reduces fine lines and wrinkles, Boosts collagen production, Improves skin elasticity, Deep hydration, Evens skin tone',
     '50ml / 1.7 fl oz', 1),

    ('Exosome Eye Contour Serum', 'exosome-eye-contour-serum',
     'A targeted exosome treatment for the delicate eye area. This lightweight serum reduces dark circles, puffiness, and crow''s feet using a concentrated blend of exosome growth factors and caffeine-infused botanicals.',
     'Targeted exosome eye treatment for dark circles and fine lines.',
     8900, 10900, 'serums',
     'Exosome Complex, Caffeine, Peptide-6, Vitamin K, Retinol 0.25%, Cucumber Extract, Chamomile Extract, Sodium Hyaluronate',
     'Reduces dark circles, Minimizes puffiness, Smooths crow''s feet, Firms eye contour, Hydrates delicate skin',
     '15ml / 0.5 fl oz', 1),

    ('Exosome Radiance Serum', 'exosome-radiance-serum',
     'A potent brightening serum powered by exosome technology and stabilized Vitamin C. This fast-absorbing formula targets hyperpigmentation, dullness, and uneven texture to reveal luminous, glass-like skin.',
     'Brightening exosome serum for luminous, even-toned skin.',
     11500, NULL, 'serums',
     'Exosome Complex, Ascorbyl Glucoside (Vitamin C), Alpha Arbutin, Tranexamic Acid, Licorice Root Extract, Ferulic Acid, Vitamin E, Hyaluronic Acid',
     'Brightens dull skin, Fades dark spots, Protects against free radicals, Smooths skin texture, Boosts radiance',
     '30ml / 1.0 fl oz', 1),

    ('Exosome Renewal Night Mask', 'exosome-renewal-night-mask',
     'An overnight recovery mask infused with exosome actives and bakuchiol. While you sleep, this rich treatment repairs daily damage, strengthens the skin barrier, and locks in intense moisture for a plump, dewy morning glow.',
     'Overnight exosome mask for deep repair and morning radiance.',
     13500, 16500, 'masks',
     'Exosome Complex, Bakuchiol, Shea Butter, Ceramide AP, Centella Asiatica, Adenosine, Allantoin, Marula Oil, Rosehip Oil, Magnesium PCA',
     'Overnight skin repair, Strengthens skin barrier, Intense moisture lock, Anti-aging benefits, Morning radiance boost',
     '75ml / 2.5 fl oz', 0),

    ('Exosome Gentle Cleanser', 'exosome-gentle-cleanser',
     'A pH-balanced gel cleanser that preps skin for maximum exosome absorption. Infused with amino acids and prebiotics, it removes impurities without stripping the skin''s natural moisture barrier.',
     'pH-balanced gel cleanser that preps skin for exosome treatments.',
     4900, NULL, 'cleansers',
     'Amino Acid Surfactants, Prebiotic Complex, Centella Asiatica, Panthenol, Glycerin, Tea Tree Extract, Chamomile Water, Betaine',
     'Gentle yet effective cleansing, Maintains skin pH balance, Preps skin for treatments, Preserves moisture barrier, Soothes sensitive skin',
     '150ml / 5.0 fl oz', 0),

    ('Exosome Complete Ritual Set', 'exosome-complete-ritual-set',
     'The complete Exosome skincare ritual in one luxurious set. Includes our Gentle Cleanser, Radiance Serum, Rejuvenation Cream, and Renewal Night Mask — everything you need for a transformative morning-to-night routine.',
     'Complete 4-piece exosome skincare ritual for total transformation.',
     39900, 52800, 'sets',
     'See individual products for full ingredient lists.',
     'Complete skincare routine, Saves vs. buying individually, Morning and night coverage, Progressive results, Luxurious unboxing experience',
     '4-piece set', 1);

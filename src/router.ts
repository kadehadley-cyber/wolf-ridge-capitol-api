type Handler = (request: Request, env: Env, params: Record<string, string>) => Promise<Response>;

interface Route {
	method: string;
	pattern: URLPattern;
	handler: Handler;
}

export class Router {
	private routes: Route[] = [];

	on(method: string, path: string, handler: Handler) {
		this.routes.push({
			method: method.toUpperCase(),
			pattern: new URLPattern({ pathname: path }),
			handler,
		});
	}

	get(path: string, handler: Handler) { this.on('GET', path, handler); }
	post(path: string, handler: Handler) { this.on('POST', path, handler); }
	put(path: string, handler: Handler) { this.on('PUT', path, handler); }
	delete(path: string, handler: Handler) { this.on('DELETE', path, handler); }

	async handle(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);

		for (const route of this.routes) {
			if (route.method !== request.method && route.method !== 'ALL') continue;
			const match = route.pattern.exec(url);
			if (!match) continue;
			const params = match.pathname.groups as Record<string, string>;
			return route.handler(request, env, params);
		}

		return json({ error: 'Not found' }, 404);
	}
}

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: {
			'Content-Type': 'application/json',
			'Access-Control-Allow-Origin': '*',
			'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
			'Access-Control-Allow-Headers': 'Content-Type',
			...headers,
		},
	});
}

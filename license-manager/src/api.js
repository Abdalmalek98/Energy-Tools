// Thin client for the licensing service admin API. The admin token lives only in memory of this process.
export class AdminApi {
  constructor(baseUrl, token) {
    this.base = baseUrl.replace(/\/+$/, '');
    this.token = token;
  }
  async call(method, path, body) {
    const res = await fetch(this.base + '/v1/admin' + path, {
      method,
      headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(json.message || `HTTP ${res.status}`), { status: res.status, code: json.error });
    return json;
  }
  list() { return this.call('GET', '/licenses'); }
  get(id) { return this.call('GET', `/licenses/${encodeURIComponent(id)}`); }
  token_(id) { return this.call('GET', `/licenses/${encodeURIComponent(id)}/token`); }
  create(input) { return this.call('POST', '/licenses', input); }
  action(id, action, body = {}) { return this.call('POST', `/licenses/${encodeURIComponent(id)}/${action}`, body); }
  update(id, patch) { return this.call('PATCH', `/licenses/${encodeURIComponent(id)}`, patch); }
  deactivateMachine(activationId) { return this.call('POST', `/activations/${activationId}/deactivate`, {}); }
  audit(id) { return this.call('GET', `/audit${id ? `?license=${encodeURIComponent(id)}` : ''}`); }
}

const addressNames = ['street', 'neighborhood', 'city', 'state'];
const digits = value => String(value ?? '').replace(/\D/g, '');
export const formatZipCode = value => digits(value).slice(0, 8).replace(/^(\d{5})(\d)/, '$1-$2');

/** A missing CEP is a normal result; transport failures reject and permit manual entry. */
export async function lookupAddress(zipCode, { fetchImpl = globalThis.fetch, signal, timeoutMs = 6000 } = {}) {
  if (!/^\d{8}$/.test(zipCode)) return { status: 'invalid' };
  const controller = new AbortController();
  let timer;
  let rejectAbort;
  const aborted = new Promise((_, reject) => { rejectAbort = reject; });
  const abort = () => {
    controller.abort();
    rejectAbort(new DOMException('Consulta cancelada', 'AbortError'));
  };
  signal?.addEventListener('abort', abort, { once: true });
  timer = setTimeout(abort, timeoutMs);
  try {
    if (signal?.aborted) abort();
    const request = (async () => {
      const response = await fetchImpl(`https://viacep.com.br/ws/${zipCode}/json/`, { signal: controller.signal });
      if (!response.ok) throw new Error('CEP service unavailable');
      const data = await response.json();
      if (data.erro === true || data.erro === 'true') return { status: 'not-found' };
      if (typeof data.localidade !== 'string' || !data.localidade || !/^[A-Z]{2}$/.test(data.uf)) {
        throw new Error('Invalid CEP response');
      }
      return { status: 'success', address: {
        street: typeof data.logradouro === 'string' ? data.logradouro : '',
        neighborhood: typeof data.bairro === 'string' ? data.bairro : '',
        city: data.localidade, state: data.uf,
      } };
    })();
    return await Promise.race([request, aborted]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

/** Keep state in memory across form replacements; cleanup before mounting again. */
export function mountAddressAutofill(form, {
  onUpdate = () => {}, lookup = lookupAddress, debounceMs = 250, state = {},
} = {}) {
  const zip = form.querySelector('[name="zipCode"]');
  const status = form.querySelector('[data-cep-status]');
  const retry = form.querySelector('[data-cep-retry]');
  if (!zip) return () => {};
  const fields = Object.fromEntries(addressNames.map(name => [name, form.querySelector(`[name="${name}"]`)]));
  const owned = state.owned instanceof Map ? state.owned : (state.owned = new Map());
  for (const [name, value] of owned) {
    if (fields[name]?.value !== value) owned.delete(name);
  }
  const revisions = new Map();
  const listeners = [];
  let current = state.zipCode || '', attempted = '', timer, controller, generation = 0, disposed = false;
  status?.setAttribute('role', 'status');
  status?.setAttribute('aria-live', 'polite');
  status?.setAttribute('aria-atomic', 'true');
  const announce = (state, text) => {
    if (status) { status.dataset.state = state; status.textContent = text; }
    if (retry) retry.hidden = state !== 'error';
  };
  const listen = (element, event, fn) => {
    element?.addEventListener(event, fn);
    listeners.push(() => element?.removeEventListener(event, fn));
  };
  const write = (name, value) => {
    fields[name].value = value;
    onUpdate({ name, value });
  };
  for (const [name, field] of Object.entries(fields)) {
    const edited = () => { revisions.set(name, (revisions.get(name) || 0) + 1); owned.delete(name); };
    listen(field, 'input', edited);
    listen(field, 'change', edited);
  }
  const run = async () => {
    if (disposed || current.length !== 8 || attempted === current) return;
    attempted = current;
    controller = new AbortController();
    const id = generation;
    const snapshots = Object.fromEntries(addressNames.map(name => [name, {
      value: fields[name]?.value, revision: revisions.get(name) || 0,
    }]));
    announce('loading', 'Buscando endereço pelo CEP… Você pode preencher manualmente.');
    try {
      const result = await lookup(current, { signal: controller.signal });
      if (disposed || id !== generation) return;
      if (result.status === 'not-found') {
        announce('not-found', 'CEP não encontrado. Confira o CEP ou preencha o endereço manualmente.');
        return;
      }
      if (result.status !== 'success') throw new Error('Invalid CEP');
      for (const name of addressNames) {
        const field = fields[name], previous = snapshots[name], value = result.address[name];
        if (!field || !value || previous.value || field.value !== previous.value ||
          (revisions.get(name) || 0) !== previous.revision) continue;
        write(name, value);
        owned.set(name, value);
      }
      announce('success', 'CEP encontrado. Confira o endereço e complete o número e os campos que faltam.');
    } catch {
      if (!disposed && id === generation) {
        announce('error', 'Não foi possível consultar o CEP. Preencha manualmente ou tente novamente.');
      }
    }
  };
  const update = event => {
    if (event?.isComposing || disposed) return;
    const raw = zip.value, start = zip.selectionStart, end = zip.selectionEnd;
    const formatted = formatZipCode(raw);
    if (formatted !== raw) {
      zip.value = formatted;
      if (start != null && end != null && typeof zip.setSelectionRange === 'function') {
        const caret = position => {
          const count = Math.min(digits(raw.slice(0, position)).length, 8);
          return count + (count > 5 ? 1 : 0);
        };
        zip.setSelectionRange(caret(start), caret(end));
      }
    }
    onUpdate({ name: 'zipCode', value: formatted });
    const next = digits(formatted);
    if (next !== current) {
      generation++;
      controller?.abort();
      clearTimeout(timer);
      attempted = '';
      current = next;
      state.zipCode = next;
      for (const [name, value] of owned) if (fields[name].value === value) write(name, '');
      owned.clear();
      announce('idle', next ? 'Digite os 8 dígitos do CEP para buscar o endereço.' : 'Informe o CEP para preencher o endereço automaticamente.');
    }
    if (current.length === 8 && attempted !== current) {
      clearTimeout(timer);
      if (event?.type === 'blur' || event?.type === 'change') void run();
      else timer = setTimeout(run, debounceMs);
    }
  };
  for (const event of ['input', 'change', 'blur', 'compositionend']) listen(zip, event, update);
  listen(retry, 'click', event => {
    event.preventDefault();
    attempted = '';
    update({ type: 'change' });
  });
  announce('idle', 'Informe o CEP para preencher o endereço automaticamente.');
  update();
  return () => {
    disposed = true;
    generation++;
    clearTimeout(timer);
    controller?.abort();
    listeners.forEach(remove => remove());
  };
}

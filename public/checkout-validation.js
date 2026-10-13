const names = ['name', 'email', 'document', 'phone', 'zipCode', 'street', 'number', 'complement', 'neighborhood', 'city', 'state'];
const states = new Set('AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' '));
const digits = value => value.replace(/\D/g, '');

// Keep the checksum in sync with validCPF in worker/payments.mjs.
function validCPF(value) {
  const cpf = digits(value);
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1+$/.test(cpf)) return false;
  return [9, 10].every(length => {
    let sum = 0;
    for (let i = 0; i < length; i++) sum += Number(cpf[i]) * (length + 1 - i);
    const check = (sum * 10) % 11;
    return Number(cpf[length]) === (check === 10 ? 0 : check);
  });
}

/** Returns a field message or an empty string when valid. Server validation remains authoritative. */
export function validationError(name, input) {
  const value = typeof input === 'string' ? input.trim() : '';
  switch (name) {
    case 'name': return /\S+\s+\S+/.test(value) ? '' : 'Informe seu nome e sobrenome.';
    case 'email': return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? '' : 'Informe um e-mail válido, como nome@exemplo.com.';
    case 'document': return validCPF(value) ? '' : 'Confira o CPF. Informe os 11 dígitos de um CPF válido.';
    case 'phone': return /^\d{10,11}$/.test(digits(value)) ? '' : 'Informe o telefone com DDD, com 10 ou 11 dígitos.';
    case 'zipCode': return /^\d{8}$/.test(digits(value)) ? '' : 'Informe os 8 dígitos do CEP.';
    case 'street': return value.length >= 3 ? '' : 'Informe a rua ou avenida, com pelo menos 3 caracteres.';
    case 'number': return value ? '' : 'Informe o número. Se não houver, escreva S/N.';
    case 'neighborhood': return value ? '' : 'Informe o bairro.';
    case 'city': return value.length >= 2 ? '' : 'Informe a cidade, com pelo menos 2 caracteres.';
    case 'state': return states.has(value.toUpperCase()) ? '' : 'Informe uma UF válida, como SP ou RJ.';
    default: return '';
  }
}

function showError(form, field, message) {
  const target = form.querySelector(`[data-field-error="${field.name}"]`);
  if (target) target.textContent = message;
  if (message) field.setAttribute('aria-invalid', 'true');
  else field.removeAttribute('aria-invalid');
}

/** Reports all errors and moves focus only when the user attempts to submit. */
export function validateCheckoutForm(form) {
  let firstInvalid;
  for (const name of names) {
    const field = form.querySelector(`[name="${name}"]`);
    if (!field) continue;
    const message = validationError(name, field.value);
    showError(form, field, message);
    if (message && !firstInvalid) firstInvalid = field;
  }
  firstInvalid?.focus();
  return !firstInvalid;
}

/** Call cleanup before replacing the checkout form. */
export function mountCheckoutValidation(form) {
  const remove = [];
  for (const name of names) {
    const field = form.querySelector(`[name="${name}"]`);
    if (!field) continue;
    const onInput = () => showError(form, field, '');
    const onBlur = () => {
      if (name === 'state') {
        const upper = field.value.trim().toUpperCase();
        if (upper !== field.value) {
          field.value = upper;
          // Let the checkout's existing input listener synchronize its draft.
          field.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }
      showError(form, field, validationError(name, field.value));
    };
    field.addEventListener('input', onInput);
    field.addEventListener('blur', onBlur);
    remove.push(() => {
      field.removeEventListener('input', onInput);
      field.removeEventListener('blur', onBlur);
    });
  }
  return () => remove.forEach(unsubscribe => unsubscribe());
}

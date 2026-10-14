export function createCheckoutDrawer({onClose, root = document, view = window}) {
  let dialog, content, previousFocus, pageScroll = 0, previousOverflow = '';
  return {
    get isOpen() { return Boolean(dialog?.open); },
    get scrollY() { return pageScroll; },
    open(html) {
      const firstOpen = !dialog;
      if (firstOpen) {
        previousFocus = root.activeElement;
        pageScroll = view.scrollY;
        previousOverflow = root.documentElement.style.overflow;
        dialog = root.createElement('dialog');
        dialog.className = 'checkout-drawer';
        dialog.setAttribute('aria-labelledby', 'checkout-drawer-title');
        dialog.innerHTML = '<header class="checkout-drawer-header"><h2 id="checkout-drawer-title">Finalizar compra</h2><button type="button" class="icon-button checkout-drawer-close" aria-label="Fechar checkout">✕</button></header><div class="checkout-drawer-content"></div>';
        content = dialog.querySelector('.checkout-drawer-content');
        dialog.querySelector('.checkout-drawer-close').addEventListener('click', onClose);
        dialog.addEventListener('cancel', event => { event.preventDefault(); onClose(); });
        dialog.addEventListener('keydown', event => {
          if (event.key !== 'Tab') return;
          const controls = Array.from(dialog.querySelectorAll('a[href], button, input, select, textarea, summary, [tabindex]'))
            .filter(element => element.tabIndex >= 0 && !element.matches(':disabled') && element.getClientRects().length);
          const first = controls[0], last = controls[controls.length - 1];
          if (event.shiftKey && root.activeElement === first) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && root.activeElement === last) { event.preventDefault(); first?.focus(); }
        });
        dialog.addEventListener('click', event => {
          if (event.target !== dialog) return;
          const rect = dialog.getBoundingClientRect();
          if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose();
        });
        root.body.append(dialog);
        root.documentElement.style.overflow = 'hidden';
      }
      const scrollTop = content.scrollTop;
      const active = content.contains(root.activeElement) ? root.activeElement : null;
      const focusId = active?.id, focusName = active?.name;
      content.innerHTML = html;
      if (firstOpen) {
        dialog.showModal();
        dialog.querySelector('.checkout-drawer-close').focus({preventScroll:true});
      } else {
        if (focusId || focusName) {
          Array.from(content.querySelectorAll('[id], [name]')).find(element => focusId ? element.id === focusId : element.name === focusName)?.focus({preventScroll:true});
        }
        content.scrollTop = scrollTop;
      }
    },
    close() {
      if (!dialog) return;
      dialog.close();
      dialog.remove();
      dialog = content = null;
      root.documentElement.style.overflow = previousOverflow;
      view.scrollTo({top:pageScroll, behavior:'instant'});
      if (previousFocus?.isConnected) previousFocus.focus({preventScroll:true});
    },
  };
}

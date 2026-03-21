import { DialogComponent, DialogOpenEvent } from '@theme/dialog';
import { CartAddEvent } from '@theme/events';

/**
 * A custom element that manages a cart drawer.
 *
 * @typedef {object} Refs
 * @property {HTMLDialogElement} dialog - The dialog element.
 *
 * @extends {DialogComponent}
 */
class CartDrawerComponent extends DialogComponent {
  /** @type {number} */
  #summaryThreshold = 0.5;

  /* ---- Recommendations state ---- */
  /** @type {string} Cached card HTML for re-injection after morph */
  #recoCachedHTML = '';
  /** @type {string|null} Product ID the cache was built for */
  #recoCachedProductId = null;
  /** @type {boolean} Guard to prevent MutationObserver re-entrancy */
  #recoIsInjecting = false;
  /** @type {MutationObserver|null} */
  #recoObserver = null;

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener(CartAddEvent.eventName, this.#handleCartAdd);
    this.addEventListener(DialogOpenEvent.eventName, this.#updateStickyState);
    this.addEventListener(DialogOpenEvent.eventName, this.#onDrawerOpen);
    this.#setupRecoEventDelegation();

    // Pre-fetch recommendations on page load so they're ready when the drawer opens
    this.#prefetchRecommendations();
    // Watch for morph-caused track emptying and re-inject cached cards
    this.#setupRecoObserver();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener(CartAddEvent.eventName, this.#handleCartAdd);
    this.removeEventListener(DialogOpenEvent.eventName, this.#updateStickyState);
    this.removeEventListener(DialogOpenEvent.eventName, this.#onDrawerOpen);
    if (this.#recoObserver) {
      this.#recoObserver.disconnect();
      this.#recoObserver = null;
    }
  }

  #handleCartAdd = () => {
    if (this.hasAttribute('auto-open')) {
      this.showDialog();
    }
  };

  open() {
    this.showDialog();

    /**
     * Close cart drawer when installments CTA is clicked to avoid overlapping dialogs
     */
    customElements.whenDefined('shopify-payment-terms').then(() => {
      const installmentsContent = document.querySelector('shopify-payment-terms')?.shadowRoot;
      const cta = installmentsContent?.querySelector('#shopify-installments-cta');
      cta?.addEventListener('click', this.closeDialog, { once: true });
    });
  }

  close() {
    this.closeDialog();
  }

  #updateStickyState() {
    const { dialog } = /** @type {Refs} */ (this.refs);
    if (!dialog) return;

    // Refs do not cross nested `*-component` boundaries (e.g., `cart-items-component`), so we query within the dialog.
    const content = dialog.querySelector('.cart-drawer__content');
    const summary = dialog.querySelector('.cart-drawer__summary');

    if (!content || !summary) {
      // Ensure the dialog doesn't get stuck in "unsticky" mode when summary disappears (e.g., empty cart).
      dialog.setAttribute('cart-summary-sticky', 'false');
      return;
    }

    const drawerHeight = dialog.getBoundingClientRect().height;
    const summaryHeight = summary.getBoundingClientRect().height;
    const ratio = summaryHeight / drawerHeight;
    dialog.setAttribute('cart-summary-sticky', ratio > this.#summaryThreshold ? 'false' : 'true');
  }

  /* ---- Recommendations ---- */

  #onDrawerOpen = () => {
    // On drawer open, inject from cache instantly (or fetch if not cached yet)
    this.#injectRecommendations();
  };

  /**
   * Pre-fetch recommendations on page load so they're cached before the drawer opens.
   * Only applies to the "recommendations" source (API-based).
   */
  #prefetchRecommendations() {
    const container = this.querySelector('.cart-reco[data-source="recommendations"]');
    if (!container) return;

    const productId = container.getAttribute('data-product-id');
    if (!productId) return;

    this.#fetchAndCacheRecommendations(productId);
  }

  /**
   * Fetches product recommendations from the API, builds card HTML, and caches it.
   * @param {string} productId
   */
  #fetchAndCacheRecommendations(productId) {
    // Don't re-fetch if already cached for the same product
    if (this.#recoCachedProductId === productId && this.#recoCachedHTML) return;

    this.#recoCachedProductId = productId;

    const bgColor = getComputedStyle(this.querySelector('.cart-drawer__dialog') || document.documentElement)
      .getPropertyValue('--arenus-cart-image-bg')?.trim() || '#fffcea';

    fetch(`/recommendations/products.json?product_id=${productId}&limit=10&intent=complementary`)
      .then((res) => res.json())
      .then((data) => {
        if (!data.products || data.products.length === 0) {
          return fetch(`/recommendations/products.json?product_id=${productId}&limit=10&intent=related`)
            .then((res) => res.json());
        }
        return data;
      })
      .then((data) => {
        if (!data.products || data.products.length === 0) return;

        const html = this.#buildRecoCardsHTML(data.products, bgColor);
        this.#recoCachedHTML = html;

        // If the track currently exists and is empty, inject immediately
        this.#injectRecommendations();
      })
      .catch((err) => {
        console.error('Recommendations fetch error:', err);
      });
  }

  /**
   * Builds card HTML from an array of product objects.
   * @param {Array} products
   * @param {string} bgColor
   * @returns {string}
   */
  #buildRecoCardsHTML(products, bgColor) {
    const handbagSvg = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M22.4893 18.5737L21.1525 7.32375C21.1091 6.95721 20.9321 6.61952 20.6554 6.37529C20.3786 6.13106 20.0215 5.99744 19.6525 6H16.4996C16.4996 4.80653 16.0255 3.66193 15.1816 2.81802C14.3377 1.97411 13.1931 1.5 11.9996 1.5C10.8062 1.5 9.66157 1.97411 8.81766 2.81802C7.97374 3.66193 7.49964 4.80653 7.49964 6H4.34308C3.97399 5.99744 3.61691 6.13106 3.34016 6.37529C3.06342 6.61952 2.88644 6.95721 2.84308 7.32375L1.5062 18.5737C1.4817 18.7837 1.50186 18.9965 1.56536 19.1981C1.62885 19.3998 1.73425 19.5857 1.87464 19.7438C2.01604 19.9025 2.18932 20.0296 2.38317 20.1168C2.57701 20.204 2.78707 20.2494 2.99964 20.25H20.9921C21.206 20.2505 21.4175 20.2056 21.6127 20.1183C21.8079 20.0311 21.9824 19.9034 22.1246 19.7438C22.2644 19.5854 22.3691 19.3993 22.4319 19.1977C22.4948 18.9961 22.5143 18.7835 22.4893 18.5737ZM11.9996 3C12.7953 3 13.5584 3.31607 14.121 3.87868C14.6836 4.44129 14.9996 5.20435 14.9996 6H8.99964C8.99964 5.20435 9.31571 4.44129 9.87832 3.87868C10.4409 3.31607 11.204 3 11.9996 3ZM2.99964 18.75L4.34308 7.5H7.49964V9.75C7.49964 9.94891 7.57866 10.1397 7.71931 10.2803C7.85996 10.421 8.05073 10.5 8.24964 10.5C8.44855 10.5 8.63932 10.421 8.77997 10.2803C8.92062 10.1397 8.99964 9.94891 8.99964 9.75V7.5H14.9996V9.75C14.9996 9.94891 15.0787 10.1397 15.2193 10.2803C15.36 10.421 15.5507 10.5 15.7496 10.5C15.9486 10.5 16.1393 10.421 16.28 10.2803C16.4206 10.1397 16.4996 9.94891 16.4996 9.75V7.5H19.6637L20.9921 18.75H2.99964Z" fill="currentColor"/></svg>`;

    let html = '';
    products.forEach((product) => {
      if (!product.available) return;

      const isSingle = product.variants.length === 1;
      const firstVariant = product.variants[0];
      const price = this.#formatPrice(firstVariant.price);
      const singleAttr = isSingle ? ' data-single-variant="true"' : '';

      const escapedTitle = product.title.replace(/"/g, '&quot;');
      const imgSrc = product.featured_image || product.images?.[0] || '';

      // Embed inline JSON for multi-variant products (avoids /products/handle.json fetch)
      let inlineDataScript = '';
      if (!isSingle) {
        const normalizedOptions = this.#normalizeProductOptions(product);
        const cardData = {
          title: product.title,
          image: imgSrc,
          options: normalizedOptions,
          variants: product.variants.map((v) => ({
            id: v.id,
            available: v.available,
            price: v.price,
            compare_at_price: v.compare_at_price || 0,
            option1: v.option1 || null,
            option2: v.option2 || null,
            option3: v.option3 || null,
          })),
        };
        inlineDataScript = `<script type="application/json" class="cart-reco__card-data">${JSON.stringify(cardData)}<\/script>`;
      }

      html += `<div class="cart-reco__card" data-product-id="${product.id}">` +
        inlineDataScript +
        `<a href="${product.url}" class="cart-reco__card-link">` +
        `<div class="cart-reco__card-image" style="background-color: ${bgColor};">` +
        `<img src="${imgSrc}" alt="${escapedTitle}" width="121" height="121" loading="lazy" />` +
        `</div>` +
        `<div class="cart-reco__card-info">` +
        `<span class="cart-reco__card-title">${product.title}</span>` +
        `<span class="cart-reco__card-price">${price}</span>` +
        `</div></a>` +
        `<button type="button" class="cart-reco__add-btn" data-variant-id="${firstVariant.id}" data-product-id="${product.id}" data-product-url="${product.url}"${singleAttr} aria-label="Add ${escapedTitle} to cart">` +
        `${handbagSvg} ADD</button>` +
        `</div>`;
    });

    return html;
  }

  /**
   * Injects cached recommendation cards into the track if it's empty.
   * Used on drawer open and after morph re-sets the track.
   */
  #injectRecommendations() {
    if (this.#recoIsInjecting) return;

    const container = this.querySelector('.cart-reco[data-source="recommendations"]');
    if (!container) return;

    const track = container.querySelector('.cart-reco__track');
    if (!track) return;

    // Already populated — nothing to do
    if (track.children.length > 0) return;

    if (this.#recoCachedHTML) {
      this.#recoIsInjecting = true;
      track.innerHTML = this.#recoCachedHTML;
      this.#recoIsInjecting = false;
      return;
    }

    // Cache not ready yet — check if product_id changed and re-fetch
    const productId = container.getAttribute('data-product-id');
    if (productId && productId !== this.#recoCachedProductId) {
      this.#fetchAndCacheRecommendations(productId);
    }
  }

  /**
   * Observes the cart-drawer-component subtree for DOM changes (triggered by morphSection).
   * When morph empties the recommendations track, re-injects cached cards.
   *
   * No debounce needed — MutationObserver callbacks are already batched (fire once
   * after all mutations in a script execution context) and run before the browser
   * paints, so re-injection is invisible to the user.
   */
  #setupRecoObserver() {
    this.#recoObserver = new MutationObserver(() => {
      if (this.#recoIsInjecting) return;
      this.#injectRecommendations();
    });

    this.#recoObserver.observe(this, { childList: true, subtree: true });
  }

  #setupRecoEventDelegation() {
    // Carousel navigation + add-to-cart (event delegation)
    this.addEventListener('click', (e) => {
      const prevBtn = e.target.closest('.cart-reco__nav-btn--prev');
      const nextBtn = e.target.closest('.cart-reco__nav-btn--next');
      if (prevBtn || nextBtn) {
        const track = this.querySelector('.cart-reco__track');
        if (!track) return;
        const card = track.querySelector('.cart-reco__card');
        if (!card) return;
        const gap = parseFloat(getComputedStyle(track).columnGap) || parseFloat(getComputedStyle(track).gap) || 0;
        const scrollAmount = card.offsetWidth + gap;
        track.scrollBy({ left: prevBtn ? -scrollAmount : scrollAmount, behavior: 'smooth' });
      }

      // Add-to-cart from recommendation cards
      const addBtn = e.target.closest('.cart-reco__add-btn');
      if (!addBtn) return;
      e.preventDefault();
      e.stopPropagation();

      if (addBtn.hasAttribute('data-single-variant')) {
        const variantId = parseInt(addBtn.getAttribute('data-variant-id'));
        this.#addRecoToCart(variantId, 1, addBtn);
      } else {
        // Multi-variant: read inline JSON data from the card and open quick-add modal
        const card = addBtn.closest('.cart-reco__card');
        const dataScript = card?.querySelector('script.cart-reco__card-data');
        if (dataScript) {
          try {
            const productData = JSON.parse(dataScript.textContent);
            // Attach product ID from the card element for post-add removal
            productData.id = card.getAttribute('data-product-id');
            this.#openQuickAddModal(productData, addBtn);
          } catch (err) {
            console.error('[cart-drawer] Failed to parse card data:', err);
          }
        }
      }
    });
  }

  #recoIsAdding = false;

  /**
   * Removes a recommendation card from both the live DOM and the cached HTML
   * so it doesn't reappear after morphSection re-injects the cache.
   * @param {string|number} productId
   */
  #removeRecoCard(productId) {
    const card = this.querySelector(`.cart-reco__card[data-product-id="${productId}"]`);
    if (card) card.remove();

    // Update cached HTML for recommendations source (prevents re-injection after morph)
    if (this.#recoCachedHTML) {
      const temp = document.createElement('div');
      temp.innerHTML = this.#recoCachedHTML;
      const cachedCard = temp.querySelector(`.cart-reco__card[data-product-id="${productId}"]`);
      if (cachedCard) cachedCard.remove();
      this.#recoCachedHTML = temp.innerHTML;
    }
  }

  /**
   * Collects section IDs from all cart-items-components for bundled section rendering.
   * @returns {string} Comma-separated section IDs
   */
  #getCartSectionIds() {
    const ids = [];
    document.querySelectorAll('cart-items-component').forEach((el) => {
      if (el instanceof HTMLElement && el.dataset.sectionId) {
        ids.push(el.dataset.sectionId);
      }
    });
    return ids.join(',');
  }

  #addRecoToCart(variantId, qty, triggerBtn) {
    if (this.#recoIsAdding) return;
    this.#recoIsAdding = true;
    if (triggerBtn) {
      triggerBtn.classList.add('is-loading');
      triggerBtn.disabled = true;
    }

    const sections = this.#getCartSectionIds();

    fetch('/cart/add.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ id: variantId, quantity: qty, sections }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.status) {
          console.error('Add to cart error:', data.description);
          this.#recoIsAdding = false;
          if (triggerBtn) {
            triggerBtn.classList.remove('is-loading');
            triggerBtn.disabled = false;
          }
          return;
        }
        // Remove the card from recommendations (already in cart now)
        const productId = triggerBtn?.getAttribute('data-product-id');
        if (productId) this.#removeRecoCard(productId);

        this.dispatchEvent(
          new CartAddEvent({}, '', {
            source: 'cart-reco-add',
            itemCount: qty,
            variantId: variantId.toString(),
            sections: data.sections || {},
          })
        );
        this.#recoIsAdding = false;
        if (triggerBtn) {
          triggerBtn.classList.remove('is-loading');
          triggerBtn.disabled = false;
        }
      })
      .catch((err) => {
        console.error('Add to cart fetch error:', err);
        this.#recoIsAdding = false;
        if (triggerBtn) {
          triggerBtn.classList.remove('is-loading');
          triggerBtn.disabled = false;
        }
      });
  }

  /* ---- Quick-add modal (self-contained, uses inline JSON data from cards) ---- */

  /** @type {{ product: object, selectedOptions: string[], quantity: number } | null} */
  #qamState = null;
  /** @type {HTMLDialogElement|null} Persistent reference — moved to document.body on first use */
  #qamDialog = null;
  /** @type {boolean} Whether listeners have been bound to the body-level dialog */
  #qamListenersReady = false;

  /**
   * Ensures the QAM dialog is on document.body (not nested inside the cart drawer
   * dialog, which breaks showModal in the top layer) and has its event listeners.
   * @returns {HTMLDialogElement|null}
   */
  #ensureQamDialog() {
    // Already moved to body — reuse it
    if (this.#qamDialog && this.#qamDialog.isConnected) return this.#qamDialog;

    // Find the Liquid-rendered dialog (may have been re-created by morphSection)
    const dialog = document.getElementById('cart-reco-qam');
    if (!dialog) return null;

    // Move it out of the cart-drawer dialog to document.body so showModal() works
    document.body.appendChild(dialog);
    this.#qamDialog = dialog;

    // Bind listeners once on this body-level element
    if (!this.#qamListenersReady) {
      this.#setupQamListeners(dialog);
      this.#qamListenersReady = true;
    }

    return dialog;
  }

  /**
   * Set up event listeners for the quick-add modal (close, options, stepper, add-to-cart).
   * @param {HTMLDialogElement} dialog
   */
  #setupQamListeners(dialog) {
    // Close button
    dialog.querySelector('.cart-reco-qam__close')?.addEventListener('click', () => this.#closeQam());

    // Backdrop click
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) this.#closeQam();
    });

    // Escape key — prevent native close, use animated close
    dialog.addEventListener('cancel', (e) => {
      e.preventDefault();
      this.#closeQam();
    });

    // Option selection (event delegation)
    dialog.querySelector('.cart-reco-qam__options')?.addEventListener('click', (e) => {
      const btn = e.target.closest('.cart-reco-qam__option-btn');
      if (!btn || !this.#qamState) return;
      const idx = parseInt(btn.getAttribute('data-option-index'), 10);
      const val = btn.getAttribute('data-option-value');
      this.#qamState.selectedOptions[idx] = val;
      this.#updateQamState();
    });

    // Quantity stepper
    dialog.querySelector('.cart-reco-qam__stepper-minus')?.addEventListener('click', () => {
      if (!this.#qamState || this.#qamState.quantity <= 1) return;
      this.#qamState.quantity--;
      const el = this.#qamDialog?.querySelector('.cart-reco-qam__stepper-value');
      if (el) el.textContent = this.#qamState.quantity;
    });

    dialog.querySelector('.cart-reco-qam__stepper-plus')?.addEventListener('click', () => {
      if (!this.#qamState) return;
      this.#qamState.quantity++;
      const el = this.#qamDialog?.querySelector('.cart-reco-qam__stepper-value');
      if (el) el.textContent = this.#qamState.quantity;
    });

    // Add to cart
    dialog.querySelector('.cart-reco-qam__add-btn')?.addEventListener('click', () => {
      if (!this.#qamState) return;
      const variant = this.#findQamVariant();
      if (!variant || !variant.available) return;
      this.#qamAddToCart(variant.id, this.#qamState.quantity);
    });
  }

  /**
   * Opens the quick-add modal for a multi-variant product.
   * Uses inline product data embedded in the card (no fetch needed).
   * @param {object} productData - Parsed product data from inline JSON
   * @param {HTMLElement} [triggerBtn] - The button that triggered (for loading state)
   */
  #openQuickAddModal(productData, triggerBtn) {
    // Ensure dialog is on document.body (not inside cart drawer's <dialog>)
    const dialog = this.#ensureQamDialog();
    if (!dialog) {
      console.error('[cart-drawer] #cart-reco-qam dialog not found');
      return;
    }

    // Normalize options to [{name, values}] format
    const normalizedOptions = this.#normalizeProductOptions(productData);
    const product = { ...productData, options: normalizedOptions };

    // Initialize state
    this.#qamState = {
      product,
      selectedOptions: normalizedOptions.map((opt) => opt.values[0]),
      quantity: 1,
    };

    // Populate header
    const img = dialog.querySelector('.cart-reco-qam__image img');
    if (img) {
      img.src = productData.image || '';
      img.alt = productData.title;
    }
    const titleEl = dialog.querySelector('.cart-reco-qam__title');
    if (titleEl) titleEl.textContent = productData.title;

    // Reset stepper
    const stepperVal = dialog.querySelector('.cart-reco-qam__stepper-value');
    if (stepperVal) stepperVal.textContent = '1';

    // Build options + update prices
    this.#updateQamState();

    // Show dialog on top layer (safe because it's now on document.body, not nested)
    dialog.classList.remove('is-closing');
    dialog.showModal();
  }

  /** Format price string from cents (e.g. 2999 → "$29.99") */
  #formatPrice(cents) {
    return '$' + (parseFloat(cents) / 100).toFixed(2);
  }

  /**
   * Normalize product options to [{name, values}] format.
   * Handles both Liquid options_with_values format and recommendations API string array format.
   * @param {object} product - Product data with options and variants
   * @returns {Array<{name: string, values: string[]}>}
   */
  #normalizeProductOptions(product) {
    if (!product.options || product.options.length === 0) return [];

    // Already in {name, values} format (Liquid inline JSON uses options_with_values)
    if (typeof product.options[0] === 'object' && product.options[0].name) {
      return product.options;
    }

    // String array format from recommendations API — derive values from variants
    return product.options.map((optionName, index) => {
      const key = `option${index + 1}`;
      const values = [];
      for (const v of product.variants) {
        if (v[key] && !values.includes(v[key])) values.push(v[key]);
      }
      return { name: optionName, values };
    });
  }

  /** Find the variant matching current selected options */
  #findQamVariant() {
    if (!this.#qamState) return null;
    const { product, selectedOptions } = this.#qamState;
    for (const v of product.variants) {
      let match = true;
      for (let j = 0; j < selectedOptions.length; j++) {
        // variant.optionN is 1-indexed (option1, option2, option3)
        if (v[`option${j + 1}`] !== selectedOptions[j]) { match = false; break; }
      }
      if (match) return v;
    }
    return null;
  }

  /** Check if a specific option value is available (has at least one available variant) */
  #isQamOptionAvailable(optionIndex, optionValue) {
    if (!this.#qamState) return false;
    const { product, selectedOptions } = this.#qamState;
    for (const v of product.variants) {
      if (v[`option${optionIndex + 1}`] !== optionValue) continue;
      let compatible = true;
      for (let j = 0; j < selectedOptions.length; j++) {
        if (j === optionIndex) continue;
        if (v[`option${j + 1}`] !== selectedOptions[j]) { compatible = false; break; }
      }
      if (compatible && v.available) return true;
    }
    return false;
  }

  /** Rebuild options UI and update prices based on current selection */
  #updateQamState() {
    const dialog = this.#qamDialog;
    if (!dialog || !this.#qamState) return;

    const { product, selectedOptions } = this.#qamState;
    const optionsContainer = dialog.querySelector('.cart-reco-qam__options');

    // Build option buttons
    if (optionsContainer) {
      optionsContainer.innerHTML = '';
      for (let i = 0; i < product.options.length; i++) {
        const opt = product.options[i];
        const group = document.createElement('div');
        group.className = 'cart-reco-qam__option-group';

        const label = document.createElement('p');
        label.className = 'cart-reco-qam__option-label';
        label.textContent = opt.name + ':';
        group.appendChild(label);

        const valuesWrap = document.createElement('div');
        valuesWrap.className = 'cart-reco-qam__option-values';

        for (const val of opt.values) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'cart-reco-qam__option-btn';
          btn.textContent = val;
          btn.setAttribute('data-option-index', i);
          btn.setAttribute('data-option-value', val);
          if (selectedOptions[i] === val) btn.classList.add('is-selected');
          if (!this.#isQamOptionAvailable(i, val)) btn.classList.add('is-unavailable');
          valuesWrap.appendChild(btn);
        }

        group.appendChild(valuesWrap);
        optionsContainer.appendChild(group);
      }
    }

    // Update prices
    const variant = this.#findQamVariant();
    const priceEl = dialog.querySelector('.cart-reco-qam__price');
    const compareEl = dialog.querySelector('.cart-reco-qam__compare-price');
    if (priceEl) priceEl.textContent = variant ? this.#formatPrice(variant.price) : '';
    if (compareEl) {
      const hasCompare = variant && variant.compare_at_price &&
        parseFloat(variant.compare_at_price) > parseFloat(variant.price);
      compareEl.textContent = hasCompare ? this.#formatPrice(variant.compare_at_price) : '';
    }

    // Update add button state
    const addBtn = dialog.querySelector('.cart-reco-qam__add-btn');
    if (addBtn) addBtn.disabled = !variant || !variant.available;
  }

  /** Close the quick-add modal with animation */
  #closeQam() {
    const dialog = this.#qamDialog;
    if (!dialog || !dialog.open) return;

    dialog.classList.add('is-closing');
    const onEnd = () => {
      dialog.removeEventListener('animationend', onEnd);
      dialog.close();
      dialog.classList.remove('is-closing');
      this.#qamState = null;
    };
    dialog.addEventListener('animationend', onEnd);
  }

  /** Add to cart from the quick-add modal, then close and refresh drawer */
  #qamAddToCart(variantId, qty) {
    const addBtn = this.#qamDialog?.querySelector('.cart-reco-qam__add-btn');
    if (addBtn) { addBtn.classList.add('is-loading'); addBtn.disabled = true; }

    const sections = this.#getCartSectionIds();

    fetch('/cart/add.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ id: variantId, quantity: qty, sections }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.status) {
          console.error('[cart-drawer] Add to cart error:', data.description);
          if (addBtn) { addBtn.classList.remove('is-loading'); addBtn.disabled = false; }
          return;
        }
        // Remove the card from recommendations (already in cart now)
        const productId = this.#qamState?.product?.id;
        if (productId) this.#removeRecoCard(productId);

        // Dispatch proper CartAddEvent with sections for cart-items-component morph
        this.dispatchEvent(
          new CartAddEvent({}, '', {
            source: 'cart-reco-qam',
            itemCount: qty,
            variantId: variantId.toString(),
            sections: data.sections || {},
          })
        );
        // Close the modal
        this.#closeQam();
      })
      .catch((err) => {
        console.error('[cart-drawer] QAM add to cart error:', err);
        if (addBtn) { addBtn.classList.remove('is-loading'); addBtn.disabled = false; }
      });
  }
}

if (!customElements.get('cart-drawer-component')) {
  customElements.define('cart-drawer-component', CartDrawerComponent);
}

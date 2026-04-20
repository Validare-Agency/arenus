/* ═══════════════════════════════════════════
   Arenus Subscription — Shared modal helper
   Renders the same subscription UI as the PDP snippet, but dynamically in JS.
   Used inside quick-add modals across collection, recommendations, products,
   search, and ambassador sections.

   Usage:
     var instance = window.ArenusSubscription.render(containerEl, productData, {
       onChange: function(state) { ... }  // optional
     });
     instance.setVariant(variantId);
     instance.getSellingPlanId();  // returns plan id or null
     instance.destroy();

   productData shape:
     {
       id, title, handle, ...,
       selling_plan_group: {
         id: 1,
         plans: [{ id: 111, name: "Delivery every 1 month" }, ...]
       },
       variants: [
         {
           id: 42, price: 19999,
           selling_plan_allocations: [
             { selling_plan_id: 111, price: 15999 }
           ]
         }
       ]
     }
   ═══════════════════════════════════════════ */

(function() {
  'use strict';

  function formatMoney(cents) {
    var n = Number(cents || 0);
    if (window.Shopify && Shopify.formatMoney) {
      try { return Shopify.formatMoney(n, '${{amount}}'); } catch (e) {}
    }
    return '$' + (n / 100).toFixed(2);
  }

  function findVariant(productData, variantId) {
    if (!productData || !productData.variants) return null;
    for (var i = 0; i < productData.variants.length; i++) {
      if (String(productData.variants[i].id) === String(variantId)) {
        return productData.variants[i];
      }
    }
    return null;
  }

  function findAllocation(variant, planId) {
    if (!variant || !variant.selling_plan_allocations) return null;
    for (var i = 0; i < variant.selling_plan_allocations.length; i++) {
      if (String(variant.selling_plan_allocations[i].selling_plan_id) === String(planId)) {
        return variant.selling_plan_allocations[i];
      }
    }
    return null;
  }

  function computeDiscountPct(variantPrice, allocationPrice, plan) {
    /* Prefer the selling plan's price adjustment (source of truth from Bold) */
    if (plan && plan.adjustment) {
      var a = plan.adjustment;
      if (a.value_type === 'percentage') return Math.round(a.value);
      if (a.value_type === 'fixed_amount' && variantPrice > 0) {
        return Math.round((a.value * 100) / variantPrice);
      }
      if (a.value_type === 'price' && variantPrice > 0) {
        return Math.round(((variantPrice - a.value) * 100) / variantPrice);
      }
    }
    /* Fall back to computed diff */
    if (!variantPrice || variantPrice <= 0) return 0;
    var diff = variantPrice - allocationPrice;
    if (diff <= 0) return 0;
    return Math.round((diff * 100) / variantPrice);
  }

  function computeDiscountedPrice(variantPrice, alloc, plan) {
    /* Apply the selling plan's adjustment directly to get the accurate discounted price */
    if (plan && plan.adjustment) {
      var a = plan.adjustment;
      if (a.value_type === 'percentage') {
        return Math.round(variantPrice * (1 - a.value / 100));
      }
      if (a.value_type === 'fixed_amount') {
        return Math.max(0, variantPrice - a.value);
      }
      if (a.value_type === 'price') {
        return a.value;
      }
    }
    if (alloc) return alloc.price;
    return variantPrice;
  }

  function findPlan(productData, planId) {
    var plans = productData.selling_plan_group.plans;
    for (var i = 0; i < plans.length; i++) {
      if (String(plans[i].id) === String(planId)) return plans[i];
    }
    return null;
  }

  function buildMarkup(productData, initialVariantId) {
    var group = productData.selling_plan_group;
    var plans = group.plans;
    var firstPlan = plans[0];
    var variant = findVariant(productData, initialVariantId) || productData.variants[0];
    var alloc = findAllocation(variant, firstPlan.id);
    var discountPct = computeDiscountPct(variant.price, alloc ? alloc.price : variant.price, firstPlan);
    var discountedPrice = computeDiscountedPrice(variant.price, alloc, firstPlan);

    var optionsHtml = '';
    for (var i = 0; i < plans.length; i++) {
      optionsHtml += '<option value="' + plans[i].id + '"' + (i === 0 ? ' selected' : '') + '>' +
        (plans[i].name || '').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</option>';
    }

    var uid = 'sub-modal-' + Date.now() + '-' + Math.floor(Math.random() * 1000);

    return (
      '<div class="arenus-sub-selector" data-sub-selector="' + uid + '" data-sub-variant="' + variant.id + '">' +
        '<input type="hidden" data-sub-plan-input value="' + firstPlan.id + '">' +

        /* Subscribe card */
        '<label class="arenus-sub-selector__card arenus-sub-selector__card--subscribe arenus-sub-selector__card--selected" data-sub-card="subscribe">' +
          '<input type="radio" name="purchase_type_' + uid + '" value="subscribe" class="arenus-sub-selector__radio-input" data-sub-radio checked>' +
          '<span class="arenus-sub-selector__radio-visual" aria-hidden="true"><span class="arenus-sub-selector__radio-dot"></span></span>' +
          '<div class="arenus-sub-selector__content">' +
            '<div class="arenus-sub-selector__top">' +
              '<div class="arenus-sub-selector__info">' +
                '<span class="arenus-sub-selector__label">Subscribe and save</span>' +
                '<div class="arenus-sub-selector__price-row">' +
                  '<span class="arenus-sub-selector__price-strike" data-sub-price-strike' + (discountPct > 0 ? '' : ' style="display:none"') + '>' + formatMoney(variant.price) + '</span>' +
                  '<span class="arenus-sub-selector__price-discount" data-sub-price-discount>' + formatMoney(discountedPrice) + '</span>' +
                '</div>' +
              '</div>' +
              '<span class="arenus-sub-selector__badge" data-sub-badge' + (discountPct > 0 ? '' : ' style="display:none"') + '>Save ' + discountPct + '%</span>' +
            '</div>' +
            '<div class="arenus-sub-selector__cadence-wrap" data-sub-cadence-wrap>' +
              '<select class="arenus-sub-selector__cadence" data-sub-cadence aria-label="Delivery frequency">' + optionsHtml + '</select>' +
              '<span class="arenus-sub-selector__cadence-caret" aria-hidden="true">' +
                '<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M5 7.5L10 12.5L15 7.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
              '</span>' +
            '</div>' +
          '</div>' +
        '</label>' +

        /* One-time card */
        '<label class="arenus-sub-selector__card arenus-sub-selector__card--onetime" data-sub-card="onetime">' +
          '<input type="radio" name="purchase_type_' + uid + '" value="onetime" class="arenus-sub-selector__radio-input" data-sub-radio>' +
          '<span class="arenus-sub-selector__radio-visual" aria-hidden="true"><span class="arenus-sub-selector__radio-dot"></span></span>' +
          '<div class="arenus-sub-selector__content">' +
            '<div class="arenus-sub-selector__info">' +
              '<span class="arenus-sub-selector__label">One-time Purchase</span>' +
              '<span class="arenus-sub-selector__price-onetime" data-sub-price-onetime>' + formatMoney(variant.price) + '</span>' +
            '</div>' +
          '</div>' +
        '</label>' +
      '</div>'
    );
  }

  function hasSubscriptions(productData) {
    return productData &&
      productData.selling_plan_group &&
      productData.selling_plan_group.plans &&
      productData.selling_plan_group.plans.length > 0;
  }

  function render(container, productData, options) {
    options = options || {};
    container.innerHTML = '';

    if (!hasSubscriptions(productData)) {
      return {
        setVariant: function() {},
        getSellingPlanId: function() { return null; },
        getMode: function() { return 'onetime'; },
        destroy: function() { container.innerHTML = ''; }
      };
    }

    var initialVariantId = options.variantId || productData.variants[0].id;
    container.innerHTML = buildMarkup(productData, initialVariantId);

    var root = container.querySelector('.arenus-sub-selector');
    var planInput = root.querySelector('[data-sub-plan-input]');
    var cadenceSelect = root.querySelector('[data-sub-cadence]');
    var priceStrikeEl = root.querySelector('[data-sub-price-strike]');
    var priceDiscountEl = root.querySelector('[data-sub-price-discount]');
    var priceOnetimeEl = root.querySelector('[data-sub-price-onetime]');
    var badgeEl = root.querySelector('[data-sub-badge]');
    var subscribeCard = root.querySelector('[data-sub-card="subscribe"]');
    var onetimeCard = root.querySelector('[data-sub-card="onetime"]');
    var radios = root.querySelectorAll('[data-sub-radio]');

    var state = {
      variantId: String(initialVariantId),
      planId: cadenceSelect ? cadenceSelect.value : String(productData.selling_plan_group.plans[0].id),
      mode: 'subscribe'
    };

    function updatePrices() {
      var v = findVariant(productData, state.variantId);
      if (!v) {
        root.style.display = 'none';
        return;
      }

      root.style.display = '';

      if (priceOnetimeEl) priceOnetimeEl.textContent = formatMoney(v.price);
      if (priceStrikeEl) priceStrikeEl.textContent = formatMoney(v.price);

      var alloc = findAllocation(v, state.planId);
      var plan = findPlan(productData, state.planId);
      var pct = computeDiscountPct(v.price, alloc ? alloc.price : v.price, plan);
      var discountedPrice = computeDiscountedPrice(v.price, alloc, plan);

      if (priceDiscountEl) priceDiscountEl.textContent = formatMoney(discountedPrice);
      subscribeCard.style.display = '';

      if (pct > 0) {
        if (priceStrikeEl) priceStrikeEl.style.display = '';
        if (badgeEl) {
          badgeEl.textContent = 'Save ' + pct + '%';
          badgeEl.style.display = '';
        }
      } else {
        if (priceStrikeEl) priceStrikeEl.style.display = 'none';
        if (badgeEl) badgeEl.style.display = 'none';
      }
    }

    function updateSelection() {
      if (state.mode === 'subscribe') {
        subscribeCard.classList.add('arenus-sub-selector__card--selected');
        onetimeCard.classList.remove('arenus-sub-selector__card--selected');
        var subRadio = subscribeCard.querySelector('[data-sub-radio]');
        if (subRadio) subRadio.checked = true;
        if (planInput) planInput.value = state.planId;
      } else {
        onetimeCard.classList.add('arenus-sub-selector__card--selected');
        subscribeCard.classList.remove('arenus-sub-selector__card--selected');
        var oneRadio = onetimeCard.querySelector('[data-sub-radio]');
        if (oneRadio) oneRadio.checked = true;
        if (planInput) planInput.value = '';
      }
      if (options.onChange) options.onChange(state);
    }

    radios.forEach(function(r) {
      r.addEventListener('change', function() {
        state.mode = r.value;
        updateSelection();
      });
    });

    if (cadenceSelect) {
      cadenceSelect.addEventListener('change', function() {
        state.planId = cadenceSelect.value;
        if (state.mode === 'subscribe' && planInput) planInput.value = state.planId;
        updatePrices();
        if (options.onChange) options.onChange(state);
      });
    }

    /* Initial render */
    updateSelection();
    updatePrices();

    return {
      setVariant: function(variantId) {
        state.variantId = String(variantId);
        root.setAttribute('data-sub-variant', String(variantId));
        updatePrices();
        updateSelection();
      },
      getSellingPlanId: function() {
        return state.mode === 'subscribe' ? state.planId : null;
      },
      getMode: function() {
        return state.mode;
      },
      destroy: function() {
        container.innerHTML = '';
      }
    };
  }

  window.ArenusSubscription = {
    render: render,
    hasSubscriptions: hasSubscriptions
  };
})();

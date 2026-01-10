'use client';

import { useEffect } from 'react';

export default function InteractionEffects() {
  useEffect(() => {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const el = entry.target as HTMLElement;
          el.dataset.sfAnimated = 'true';
          el.classList.add('animate');
        }
      });
    }, { threshold: 0.01, rootMargin: '0px 0px -10% 0px' });

    const observed = new WeakSet<Element>();

    const observeIfNeeded = (el: Element) => {
      if (!(el instanceof HTMLElement)) return;
      if (!el.classList.contains('animate-on-scroll')) return;
      if (observed.has(el)) return;
      observed.add(el);
      observer.observe(el);
    };

    const scanAndObserve = (root: ParentNode | Element) => {
      if (root instanceof Element) observeIfNeeded(root);
      root.querySelectorAll?.('.animate-on-scroll').forEach((el) => observeIfNeeded(el));
    };

    scanAndObserve(document);

    const mutationObserver = new MutationObserver((mutations) => {
      for (const m of mutations) {
        m.addedNodes.forEach((node) => {
          if (!(node instanceof Element)) return;
          scanAndObserve(node);
        });
      }
    });

    mutationObserver.observe(document.body, { childList: true, subtree: true });

    return () => {
      mutationObserver.disconnect();
      observer.disconnect();
    };
  }, []);

  return null;
}

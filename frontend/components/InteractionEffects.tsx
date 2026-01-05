'use client';

import { useEffect, useState } from 'react';

export default function InteractionEffects() {
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      setMousePosition({ x: e.clientX, y: e.clientY });
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  useEffect(() => {
    const spotlightGroups = document.querySelectorAll('.spotlight-group');

    spotlightGroups.forEach(group => {
      const spotlightBorder = group.querySelector('.spotlight-border');

      if (spotlightBorder) {
        const rect = group.getBoundingClientRect();
        const relativeX = mousePosition.x - rect.left;
        const relativeY = mousePosition.y - rect.top;

        (spotlightBorder as HTMLElement).style.setProperty('--mouse-x-rel', `${relativeX}px`);
        (spotlightBorder as HTMLElement).style.setProperty('--mouse-y-rel', `${relativeY}px`);
      }
    });

    // Update global spotlight background
    const spotlightBg = document.querySelector('.bg-spotlight');
    if (spotlightBg) {
      (spotlightBg as HTMLElement).style.setProperty('--mouse-x', `${mousePosition.x}px`);
      (spotlightBg as HTMLElement).style.setProperty('--mouse-y', `${mousePosition.y}px`);
    }
  }, [mousePosition]);

  useEffect(() => {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('animate');
        }
      });
    }, { threshold: 0.05, rootMargin: '0px 0px -10% 0px' });

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

/* Asset Library — Stitch "McSlice Rush - Asset Library".
   Internal QA reference: every shipped asset, grouped, with real
   filename and intrinsic dimensions read off the decoded image.
   Deliberately absent from the player tab bar. */
import { el, topbar, emptyState } from '../components/ui.js';
import { icon } from '../components/icons.js';
import { ASSET_GROUPS } from '../data/catalog.js';

export function AssetLibraryPage(root) {
  const tile = (item) => {
    const dims = el('small', { class: 'asset__dims', text: '…' });
    const img = el('img', {
      src: item.file,
      alt: item.name,
      loading: 'lazy',
      onLoad: (e) => {
        dims.textContent = `${e.target.naturalWidth}×${e.target.naturalHeight}`;
      },
      onError: (e) => {
        e.target.replaceWith(el('span', { class: 'asset__missing' }, icon('alert', { size: 20 })));
        dims.textContent = 'missing';
        dims.classList.add('is-bad');
      },
    });
    return el(
      'figure',
      { class: 'asset' },
      el('div', { class: 'asset__frame' }, img),
      el(
        'figcaption',
        { class: 'asset__meta' },
        el('b', { class: 'asset__name', text: item.name }),
        el('code', { class: 'asset__file', text: item.file.split('/').pop() }),
        dims,
      ),
    );
  };

  const groups = ASSET_GROUPS.map((g) =>
    el(
      'section',
      { class: 'asset-group' },
      el('h2', { class: 't-kicker section-head', text: g.group }),
      g.note && el('p', { class: 'asset-group__note', text: g.note }),
      el('div', { class: 'asset-grid' }, ...g.items.map(tile)),
    ),
  );

  root.append(
    el(
      'div',
      { class: 'screen bg-burst' },
      topbar('Asset Library', { back: '/' }),
      el('p', {
        class: 'asset-group__note',
        style: { marginBottom: '18px' },
        text: 'Internal reference for visual QA. Not part of the player flow.',
      }),
      ...(groups.length
        ? groups
        : [
            emptyState(
              '📦',
              'No assets registered',
              'Add entries to ASSET_GROUPS in src/data/catalog.js.',
            ),
          ]),
    ),
  );
}

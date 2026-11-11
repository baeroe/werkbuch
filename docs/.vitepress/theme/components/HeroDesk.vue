<script setup lang="ts">
/**
 * The hero of the landing page: the board screenshot of the front matter lies on the dot grid like a sheet, three index
 * cards drop onto it, then the command palette finds WEB-47 by typing and Enter puts the focus on its card. One sequence
 * on load, still afterwards; with reduced motion the palette stands open with its hits. Only the screenshot carries
 * meaning (its alt text), everything around it is a picture and hidden from assistive technology.
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useData, withBase } from 'vitepress';
import { copy, type Lang } from './copy';
import StatusShape from './StatusShape.vue';
import TypeGlyph from './TypeGlyph.vue';

type Image = { light: { src: string; width: number; height: number }; dark: { src: string; width: number; height: number }; alt: string };

const { frontmatter, lang } = useData();
const t = computed(() => copy[(lang.value.startsWith('de') ? 'de' : 'en') as Lang].desk);
const image = computed(() => frontmatter.value.hero.image as Image);

const TONES: Record<string, 'sky' | 'ochre' | 'moss'> = { 'WEB-47': 'ochre', 'WEB-54': 'sky', 'WEB-40': 'ochre' };

/** pre: palette closed before the sequence; typing; enter: the key is down; done: palette gone, WEB-47 focused. */
const phase = ref<'pre' | 'typing' | 'enter' | 'done' | 'still'>('pre');
const typed = ref('');
const run = ref(0);
let timers: number[] = [];

const hits = computed(() => {
    const q = typed.value.toLowerCase();
    return q === '' ? [] : t.value.results.filter((r) => r.title.toLowerCase().includes(q));
});

/** The title split around the typed text, so the hit carries the highlighter. */
function parts(title: string) {
    const q = typed.value.toLowerCase();
    const at = title.toLowerCase().indexOf(q);
    return at < 0 || q === '' ? [title, '', ''] : [title.slice(0, at), title.slice(at, at + q.length), title.slice(at + q.length)];
}

function later(ms: number, fn: () => void) {
    timers.push(window.setTimeout(fn, ms));
}

function play(again = false) {
    timers.forEach(clearTimeout);
    timers = [];
    typed.value = '';
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        typed.value = t.value.query;
        phase.value = 'still';
        return;
    }
    phase.value = 'pre';
    // a new stage plays the drop of the sheet and the cards again; the first one already plays it from the server's HTML
    if (again) run.value++;
    const query = t.value.query;
    const start = 1350;
    later(start, () => (phase.value = 'typing'));
    [...query].forEach((_, i) => later(start + 380 + i * 115, () => (typed.value = query.slice(0, i + 1))));
    const typedAt = start + 380 + query.length * 115;
    later(typedAt + 650, () => (phase.value = 'enter'));
    later(typedAt + 900, () => (phase.value = 'done'));
}

onMounted(() => play());
onBeforeUnmount(() => timers.forEach(clearTimeout));
</script>

<template>
    <div class="wb-desk">
        <div :key="run" class="stage" :class="`is-${phase}`">
            <div class="sheet">
                <img class="shot light" :src="withBase(image.light.src)" :width="image.light.width" :height="image.light.height" :alt="image.alt" fetchpriority="high" />
                <img class="shot dark" :src="withBase(image.dark.src)" :width="image.dark.width" :height="image.dark.height" :alt="image.alt" />
            </div>

            <div
                v-for="(card, i) in t.cards"
                :key="card.key"
                class="card"
                :class="[`tone-${card.tone}`, `card-${i}`, { focused: card.key === 'WEB-47' && (phase === 'done') }]"
                aria-hidden="true"
            >
                <div class="tab"><TypeGlyph :tone="card.tone" class="glyph" /><span class="key">{{ card.key }}</span></div>
                <p class="title">{{ card.title }}</p>
                <div class="meta">
                    <StatusShape :shape="card.stateShape" :class="`st-${card.stateShape}`" />
                    <span>{{ card.state }}</span>
                    <span class="avatar">{{ card.who }}</span>
                </div>
            </div>

            <div class="palette" aria-hidden="true">
                <div class="input">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
                    <span v-if="typed" class="query">{{ typed }}</span>
                    <span v-else class="placeholder">{{ t.palettePlaceholder }}</span>
                    <span class="caret" />
                </div>
                <ul class="hits">
                    <li v-for="(hit, i) in hits" :key="hit.key" :class="{ active: i === 0 }">
                        <span class="hit-tab" :class="`tone-${TONES[hit.key]}`"><TypeGlyph :tone="TONES[hit.key]" class="glyph" /></span>
                        <span class="hit-key">{{ hit.key }}</span>
                        <span class="hit-title">{{ parts(hit.title)[0] }}<mark>{{ parts(hit.title)[1] }}</mark>{{ parts(hit.title)[2] }}</span>
                        <kbd v-if="i === 0" class="enter">↵</kbd>
                    </li>
                </ul>
            </div>
        </div>
        <button v-if="phase === 'done'" type="button" class="replay" :aria-label="t.replay" :title="t.replay" @click="play(true)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" />
            </svg>
        </button>
    </div>
</template>

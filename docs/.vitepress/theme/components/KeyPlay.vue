<script setup lang="ts">
/**
 * A list to try the keys of werkbuch on: j and k move the cursor, x selects, s steps the status, Enter "opens". The page
 * hears the keys only while the list is on screen and nothing else (a field, the search) has the focus; the key caps
 * are buttons for mouse and touch. The list is a listbox: the cursor is the active option, the selection aria-selected.
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useData, withBase } from 'vitepress';
import { copy, type Lang } from './copy';
import StatusShape from './StatusShape.vue';

const { lang } = useData();
const l = computed<Lang>(() => (lang.value.startsWith('de') ? 'de' : 'en'));
const t = computed(() => copy[l.value].keys);

const SHAPES = ['circle', 'half', 'check'] as const;
const cursor = ref(2);
const selected = ref<Set<number>>(new Set());
const states = ref<number[]>([0, 1, 1, 0, 2]);
const said = ref('');
const pressed = ref<string | null>(null);
const opened = ref<number | null>(null);
const root = ref<HTMLElement | null>(null);
let inView = false;
let observer: IntersectionObserver | null = null;
let release = 0;

function press(key: string) {
    pressed.value = key;
    window.clearTimeout(release);
    release = window.setTimeout(() => (pressed.value = null), 160);
    const rows = t.value.rows;
    if (key === 'j' || key === 'k') {
        cursor.value = Math.min(rows.length - 1, Math.max(0, cursor.value + (key === 'j' ? 1 : -1)));
        said.value = t.value.moved(rows[cursor.value].key, rows[cursor.value].title);
    } else if (key === 'x') {
        const next = new Set(selected.value);
        next.has(cursor.value) ? next.delete(cursor.value) : next.add(cursor.value);
        selected.value = next;
        said.value = t.value.selected(next.size);
    } else if (key === 's') {
        states.value = states.value.map((s, i) => (i === cursor.value ? (s + 1) % SHAPES.length : s));
        said.value = t.value.status(rows[cursor.value].key, t.value.states[states.value[cursor.value]]);
    } else if (key === 'enter') {
        opened.value = cursor.value;
        said.value = t.value.opened(rows[cursor.value].key);
    }
}

const KEYS: Record<string, string> = { j: 'j', k: 'k', x: 'x', s: 's', Enter: 'enter' };

function onKey(e: KeyboardEvent) {
    const key = KEYS[e.key];
    if (!key || e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
    const at = document.activeElement;
    const ours = root.value?.contains(at) ?? false;
    // the search of the docs, a field or a link elsewhere keeps its keys
    if (!ours && (!inView || (at && at !== document.body) || document.querySelector('.VPLocalSearchBox'))) return;
    // Enter on a key cap is that button's own click
    if (key === 'enter' && at instanceof HTMLButtonElement) return;
    e.preventDefault();
    press(key);
}

onMounted(() => {
    observer = new IntersectionObserver(([entry]) => (inView = entry.intersectionRatio > 0.6), { threshold: [0, 0.6, 1] });
    if (root.value) observer.observe(root.value);
    document.addEventListener('keydown', onKey);
});

onBeforeUnmount(() => {
    observer?.disconnect();
    document.removeEventListener('keydown', onKey);
});

const caps = computed(() => [
    { key: 'j', label: 'j', text: t.value.legend.j },
    { key: 'k', label: 'k', text: t.value.legend.k },
    { key: 'x', label: 'x', text: t.value.legend.x },
    { key: 's', label: 's', text: t.value.legend.s },
    { key: 'enter', label: '↵', text: t.value.legend.enter },
]);
</script>

<template>
    <section class="wb-keys" aria-labelledby="wb-keys-title">
        <div class="copy">
            <h2 id="wb-keys-title">{{ t.heading }}</h2>
            <p>{{ t.lead }}</p>
            <div class="caps" role="group" :aria-label="t.hint">
                <button v-for="cap in caps" :key="cap.key" type="button" class="cap" :class="{ down: pressed === cap.key }" @click="press(cap.key)">
                    <kbd>{{ cap.label }}</kbd><span>{{ cap.text }}</span>
                </button>
            </div>
            <a class="more" :href="withBase(`/${l}/keyboard`)">{{ t.more }}</a>
        </div>
        <div ref="root" class="board">
            <ul
                class="rows"
                role="listbox"
                aria-multiselectable="true"
                tabindex="0"
                :aria-label="t.listLabel"
                :aria-activedescendant="`wb-key-row-${cursor}`"
            >
                <li
                    v-for="(row, i) in t.rows"
                    :id="`wb-key-row-${i}`"
                    :key="row.key"
                    role="option"
                    :aria-selected="selected.has(i)"
                    :class="{ cursor: cursor === i, picked: selected.has(i), opened: opened === i }"
                    @click="cursor = i"
                >
                    <span class="box" aria-hidden="true"><svg v-if="selected.has(i)" viewBox="0 0 24 24"><path d="m5 12 5 5 9-10" /></svg></span>
                    <StatusShape :shape="SHAPES[states[i]]" :class="`st-${SHAPES[states[i]]}`" />
                    <span class="key">{{ row.key }}</span>
                    <span class="title">{{ row.title }}</span>
                    <span class="state">{{ t.states[states[i]] }}</span>
                </li>
            </ul>
            <p class="said" role="status" aria-live="polite">{{ said || t.hint }}</p>
        </div>
    </section>
</template>

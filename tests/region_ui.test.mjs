import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// region_ui.js is a browser ES module; load it without changing the package type
// or requiring a ComfyUI instance for these visibility tests.
const source = await readFile(new URL('../web/region_ui.js', import.meta.url), 'utf8');
const { setWidgetVisible } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

function trackedWidget() {
    const writes = { hidden: 0, display: 0, computeSize: 0, computeLayoutSize: 0 };
    const originalSize = () => [120, 30];
    const originalLayout = () => ({ minHeight: 30, maxHeight: 120 });
    const widget = { element: { style: {} }, value: 'saved prompt', serialize: true };
    for (const [target, key, initial] of [
        [widget, 'hidden', false], [widget.element.style, 'display', ''],
        [widget, 'computeSize', originalSize], [widget, 'computeLayoutSize', originalLayout],
    ]) {
        let value = initial;
        Object.defineProperty(target, key, {
            configurable: true,
            get: () => value,
            set(next) { writes[key]++; value = next; },
        });
    }
    const reset = () => { for (const key of Object.keys(writes)) writes[key] = 0; };
    return { widget, writes, reset, originalSize, originalLayout };
}

for (const visible of [false, true]) {
    test(`unchanged ${visible ? 'visible' : 'hidden'} state performs no repeated writes`, () => {
        const { widget, writes, reset } = trackedWidget();
        setWidgetVisible(widget, !visible);
        assert.equal(setWidgetVisible(widget, visible), true);
        const size = widget.computeSize, layout = widget.computeLayoutSize;
        reset();
        for (let i = 0; i < 1000; i++) assert.equal(setWidgetVisible(widget, visible), false);
        assert.deepEqual(writes, { hidden: 0, display: 0, computeSize: 0, computeLayoutSize: 0 });
        assert.equal(widget.computeSize, size);
        assert.equal(widget.computeLayoutSize, layout);
    });
}

test('visibility transitions preserve original sizing and serialized values', () => {
    const { widget, originalSize, originalLayout } = trackedWidget();
    assert.equal(setWidgetVisible(widget, false), true);
    assert.equal(widget.hidden, true);
    assert.equal(widget.element.style.display, 'none');
    assert.deepEqual(widget.computeSize(), [0, -4]);
    assert.deepEqual(widget.computeLayoutSize(), { minHeight: 0, maxHeight: 0 });
    assert.equal(setWidgetVisible(widget, true), true);
    assert.equal(widget.hidden, false);
    assert.equal(widget.element.style.display, '');
    assert.equal(widget.computeSize, originalSize);
    assert.equal(widget.computeLayoutSize, originalLayout);
    assert.equal(widget.value, 'saved prompt');
    assert.equal(widget.serialize, true);
});

test('presentation-owned source widgets stay hidden until suppression is removed', () => {
    const { widget, originalSize, originalLayout } = trackedWidget();
    widget.vrpPresentationHidden = true;
    assert.equal(setWidgetVisible(widget, true), true);
    assert.equal(widget.hidden, true);
    assert.equal(setWidgetVisible(widget, true), false);
    delete widget.vrpPresentationHidden;
    assert.equal(setWidgetVisible(widget, true), true);
    assert.equal(widget.computeSize, originalSize);
    assert.equal(widget.computeLayoutSize, originalLayout);
});

test('unchanged visibility still repairs an externally changed style or callback', () => {
    const { widget, originalSize, originalLayout } = trackedWidget();
    setWidgetVisible(widget, false);
    const hiddenSize = widget.computeSize, hiddenLayout = widget.computeLayoutSize;
    widget.element.style.display = 'block';
    widget.computeSize = () => [100, 100];
    widget.computeLayoutSize = () => ({ minHeight: 100, maxHeight: 100 });
    assert.equal(setWidgetVisible(widget, false), false);
    assert.equal(widget.element.style.display, 'none');
    assert.equal(widget.computeSize, hiddenSize);
    assert.equal(widget.computeLayoutSize, hiddenLayout);
    setWidgetVisible(widget, true);
    widget.computeSize = hiddenSize;
    widget.computeLayoutSize = hiddenLayout;
    widget.element.style.display = 'none';
    assert.equal(setWidgetVisible(widget, true), false);
    assert.equal(widget.element.style.display, '');
    assert.equal(widget.computeSize, originalSize);
    assert.equal(widget.computeLayoutSize, originalLayout);
});

test('native widgets and DOM elements attached after hiding are supported', () => {
    assert.equal(setWidgetVisible(null, false), false);
    const widget = {};
    assert.equal(setWidgetVisible(widget, false), true);
    widget.element = { style: { display: '' } };
    assert.equal(setWidgetVisible(widget, false), false);
    assert.equal(widget.element.style.display, 'none');
    assert.equal(setWidgetVisible(widget, true), true);
    assert.equal(widget.computeSize, undefined);
    assert.equal(widget.computeLayoutSize, undefined);
});

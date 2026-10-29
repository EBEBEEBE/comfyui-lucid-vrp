// Editor-operation history, separate from the loader's edit-turn history.
// Raster bytes stay in immutable assets; this timeline stores metadata only.
import { parseDocument, serializeDocument, assetReferences } from './canvas_v1_document.js';

export function createDocumentHistory(value, {maxEntries=100,maxCharacters=1_000_000}={}) {
    if (![maxEntries,maxCharacters].every(number=>Number.isSafeInteger(number)&&number>0))
        throw Error('History limits must be positive safe integers');
    const original=serializeDocument(value), identity=parseDocument(original);
    let current=original;
    const undo=[], redo=[];
    const characters=()=>[...undo,...redo].reduce((total,entry)=>total+entry.length,0);
    function trim() {
        while (undo.length+redo.length>maxEntries || characters()>maxCharacters) {
            // The front of undo is oldest; the front of redo is farthest away.
            if (undo.length) undo.shift();
            else redo.shift();
        }
    }
    function move(from,to) {
        if (!from.length) return false;
        to.push(current); current=from.pop(); trim(); return true;
    }
    return {
        get current() { return parseDocument(current); },
        get dirty() { return current!==original; },
        get canUndo() { return undo.length>0; },
        get canRedo() { return redo.length>0; },
        get retainedEntries() { return undo.length+redo.length; },
        get retainedCharacters() { return characters(); },
        // Lets a future session asset cache retain every still-reachable raster.
        // This does not dispose files or implement a pixel-memory budget.
        get retainedAssetReferences() {
            return [...new Set([current,...undo,...redo].flatMap(entry=>assetReferences(entry)))];
        },
        // A transform round can roll back its operations without losing the
        // timeline (including Redo) that existed before entering the tool.
        checkpoint() {
            const saved=current, beforeUndo=[...undo], beforeRedo=[...redo];
            return Object.freeze({
                changed:()=>current!==saved,
                assetReferences:Object.freeze([...new Set([saved,...beforeUndo,...beforeRedo].flatMap(entry=>assetReferences(entry)))]),
                restore() { current=saved;undo.splice(0,undo.length,...beforeUndo);redo.splice(0,redo.length,...beforeRedo); },
            });
        },
        commit(value) {
            const next=serializeDocument(value), doc=parseDocument(next);
            if (['id','width','height'].some(key=>doc[key]!==identity[key]))
                throw Error('Editor history cannot replace the document or resize its frame');
            if (next===current) return false;
            undo.push(current); current=next; redo.length=0; trim(); return true;
        },
        undo:()=>move(undo,redo),
        redo:()=>move(redo,undo),
        discardOldest() {
            if (undo.length) { undo.shift(); return true; }
            if (redo.length) { redo.shift(); return true; }
            return false;
        },
    };
}

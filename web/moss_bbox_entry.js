// This installer targets only MOSSVisualRegionalPromptExperimental.
import {app} from './classic_adapter.js';
import * as classic from './classic_adapter.js';
import * as regionUI from './region_ui.js';
import {collectAuthoredRegions} from './region_editor.js';
import {addPromptWidget} from './string_widget_adapter.js';
import {installClassicLayout,installContentSizing} from './ui_preview_classic_adapter.js';
import {actionPanel} from './ui_preview_controls.js';
import {installMossEditor} from './moss_bbox/editor.mjs';
import {attachMossPresentation} from './moss_bbox/presentation.mjs';
installMossEditor(app,{...classic,...regionUI,collectAuthoredRegions,addPromptWidget,
    installClassicLayout,installContentSizing,actionPanel,attachMossPresentation});

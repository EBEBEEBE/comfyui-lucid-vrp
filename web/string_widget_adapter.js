// Classic ComfyUI factory boundary. Keep native textarea hooks/store behavior.
import { ComfyWidgets } from '../../scripts/widgets.js';
import { app } from './classic_adapter.js';

export function addPromptWidget(node, name, onChange, title) {
    const {widget}=ComfyWidgets.STRING(node,name,['STRING',{default:'',multiline:true,
        placeholder:title,dynamicPrompts:false}],app);
    widget.options.serialize=false;widget.serialize=false;
    widget.options.getMinHeight=()=>120;
    widget.options.getHeight=()=>150;
    widget.element.title=title;
    widget.element.style.minHeight='120px';
    // No backend input definition is created: conversion cannot invent a
    // STRING socket whose meaning depends on which region happens to be selected.
    const callback=widget.callback;
    widget.callback=function(value,...args){callback?.call(this,value,...args);onChange(value);};
    // Canonical text lives in vrp_state. Native value is only the selected view.
    return widget;
}

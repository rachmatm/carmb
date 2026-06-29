# Fixes

## ONNX Runtime WASM crash: SimplifiedLayerNormFusion

**Error:**
```
Error: Can't create a session. ERROR_CODE: 1
InsertedPrecisionFreeCast_... for node: /vit/encoder/layer.0/layernorm_before/Mul/SimplifiedLayerNormFusion/
```

**Cause:** ONNX Runtime Web's `SimplifiedLayerNormFusion` graph optimization pass crashes on RMBG-1.4's ViT architecture. Affects both the `1.26.0-dev` and `1.24.3` stable builds of `onnxruntime-web`. The pass tries to access a precision cast node that doesn't exist in the graph.

**Fix:** Disable graph optimizations via `session_options` when creating the pipeline:

```ts
segmenter = await pipeline('background-removal', 'briaai/RMBG-1.4', {
    session_options: {
        graphOptimizationLevel: 'disabled',
    },
});
```

**Applied to:** Both the RMBG-1.4 background removal model and the YOLOS plate detector.

**Note:** `graphOptimizationLevel` accepts string values (`'disabled'`, `'basic'`, `'extended'`, `'layout'`, `'all'`), not numeric. Using `0` throws `"unsupported graph optimization level: 0"`.

# Filtro de Beleza — TelePrompT

Sistema de suavização de pele em tempo real baseado em **MediaPipe Face Landmarker** (open-source, Apache 2.0). Roda 100% no dispositivo, sem upload de imagem e sem serviços pagos.

## Como funciona

1. **Detecção facial** — o `FaceLandmarker` (modelo `face_landmarker.task`, 478 pontos) roda ~5x/segundo sobre o quadro da câmera em baixa resolução (máx. 480px de largura), com `delegate: GPU` e fallback para `CPU`.
2. **Máscara de pele** — a partir do contorno facial (landmarks da `FACE_OVAL`) o rosto é "preenchido" com bordas suavizadas, recortando olhos e boca (preserva contornos).
3. **Suavização** — o quadro é desfocado (Gaussian via `ctx.filter`, GPU no Chrome) com leve clareamento/atenuação de saturação, e composto SOMENTE sobre a região da máscara de pele.
4. **Olheiras** — um segundo overlay clareia suavemente a região logo abaixo dos olhos (mais sutil que a pele).
5. **Prévia e gravação** — o efeito é aplicado no canvas que serve de prévia ao vivo E ao stream que o MediaRecorder captura. O que você vê é o que grava.

Todo o processamento intermediário roda em **meia resolução** (metade do quadro) para manter 30 FPS.

## Integração (arquivos)

- `index.html` — todo o código (seção `/* Beauty: filtro de beleza */`).
- `sw.js` — assets do MediaPipe na lista `ASSETS` (precache, funciona offline).
- `vendor/tasks-vision.mjs` — bundle do MediaPipe Tasks Vision 0.10.21 (ESM, autocontido).
- `vendor/face_landmarker.task` — modelo do Face Landmarker (float16).
- `vendor/wasm/` — `vision_wasm_internal.{js,wasm}` (SIMD) e `vision_wasm_nosimd_internal.{js,wasm}`.

## Parâmetros ajustáveis

| Parâmetro | Local | Efeito |
|---|---|---|
| `state.beautyLevel` (0–100) | slider `#beauty-range` | Intensidade geral (alfa da máscara) |
| `state.beautyOn` (bool) | botão `#btn-beauty` | Liga/desliga |
| `skinBlur` | `applyBeauty()` | Raio do blur da pele (auto, 3–12px em meia resolução, ∝ largura do rosto) |
| `feather` | `applyBeauty()` | Suavidade da borda da máscara (auto, 2–10px) |
| `brightness` do overlay ~`1 + 0.06*intensity` | `applyBeauty()` | Clareamento natural do tom (não artificial) |
| `saturate` ~`1 - 0.05*intensity` | `applyBeauty()` | Reduz leve saturação para uniformizar manchas |
| Olheiras `0.65*intensity` (máx. 0.9) | overlay `smEye` | Clareamento da área sob os olhos |
| Cadência de detecção | `detTick % 5` + `>140ms` | ~5 detecções/segundo |
| Detecção (resolução) | `ensureBeautySizes()` `dW = 480` | Reduz custo da inferência |

Ajustes de "look" (mais/menos forte) ficam em `applyBeauty()`; a intensidade do usuário multiplica todas as camadas.

## Notas de performance e limitações

- Detecção feita a cada ~5º quadro com suavização entre detecções → foco em FPS.
- Se o rosto sumir por ~2s, o efeito é desativado até nova detecção (nunca "trava" numa máscara velha).
- `Math.hypot` e `ctx.ellipse` exigem navegadores modernos (Chrome/Android e Safari recentes OK).
- `delegate: GPU` usa WebGL do MediaPipe; se falhar, cai para `CPU` automaticamente.
- Limitações conhecidas: barba/óculos ainda são tratados como pele pelo contorno (pode suavizar levemente); luz muito baixa reduz a confiança da detecção; head/hair não é suportado (não mapeia cabelo).
- Não interfere no texto do teleprompter: o overlay do texto ("Txt no vídeo") é desenhado DEPOIS do beauty, sem filtro.
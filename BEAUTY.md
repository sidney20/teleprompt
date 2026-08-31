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
| `state.beautyLevel` (0–100) | slider `#beauty-range` | Intensidade geral; **100% equivale a 40% real** (`MAX_BEAUTY`) |
| `state.beautyOn` (bool) | botão `#btn-beauty` | Liga/desliga |
| `MAX_BEAUTY` (0.4) | constante no topo | Teto da força — evita "efeito plástico" |
| `skinBlur` | `applyBeauty()` | Raio do blur sutil, auto 2–6px em meia resolução, escala com o slider |
| `feather` | `applyBeauty()` | Suavidade da borda da máscara (auto, 2–6px) |
| `brightness` ~`1 + 0.03*strength` | `applyBeauty()` | Clareamento natural bem leve |
| `saturate` ~`1 - 0.045*strength` | `applyBeauty()` | Uniformização leve de manchas |
| Olheiras `0.45*strength` (máx. 0.5) | overlay `smEye` | Clareamento sutil abaixo dos olhos |
| Cadência de detecção | `detTick % 5` + `>140ms` | ~5 detecções/segundo |
| Detecção (resolução) | `ensureBeautySizes()` `dW = 480` | Reduz custo da inferência |

## Máscara seletiva (onde o efeito atua)

A suavização é aplicada **apenas** em **testa, bochechas e queixo**:

- **Contorno do rosto**: oval interna recuada 7% em direção ao centro → cabelo, maxilar e queixo-linha ficam nítidos.
- **Excluídos da máscara** (`carveBeautyRegions`): olhos + sobrancelhas, **nariz** (ponte e narinas, `noseGeom`), e **lábios** (contorno da boca com margem extra para o sorriso).
- A textura da pele permanece: como a mescla máxima é 40%, ~60% do quadro original (poros, textura) é mantido dentro da própria máscara.

## Como testar a intensidade

1. Aperte **⚙⚙ → Beleza** e mova o slider **em tempo real** enquanto olha a prévia.
2. **0%** = desligado. **25–30%** = maquiagem leve (padrão sugerido). **50%** = uniforme, ainda natural. **100%** = visível, porém abaixo do "plástico".
3. O botão ✨ liga/desliga o recurso; se você quiser comparar, desligue e ligue para ver antes/depois na própria prévia.
4. Grave um roteiro curto e confira no arquivo: **o que você vê ao vivo é o que grava**.

## Notas de performance e limitações

- Detecção feita a cada ~5º quadro com suavização entre detecções → foco em FPS.
- Se o rosto sumir por ~2s, o efeito é desativado até nova detecção (nunca "trava" numa máscara velha).
- `Math.hypot` e `ctx.ellipse` exigem navegadores modernos (Chrome/Android e Safari recentes OK).
- `delegate: GPU` usa WebGL do MediaPipe; se falhar, cai para `CPU` automaticamente.
- Limitações conhecidas: barba/óculos ainda são tratados como pele pelo contorno (pode suavizar levemente); luz muito baixa reduz a confiança da detecção; head/hair não é suportado (não mapeia cabelo).
- Não interfere no texto do teleprompter: o overlay do texto ("Txt no vídeo") é desenhado DEPOIS do beauty, sem filtro.
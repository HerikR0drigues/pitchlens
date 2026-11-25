# Identidade visual — Pitchlens

**Pitchlens · Every player, in focus.** Scout ao vivo para o Football Manager. A identidade é sóbria:
preto, cinza e branco quente na marca; o roxo fica só dentro do app, onde carrega informação.

## Arquivos

| Arquivo | Uso |
|---|---|
| `pitchlens-mark.svg` | A marca (o "P"), sem fundo, preenchida com `currentColor`. Fonte de verdade do desenho. |
| `pitchlens-logo-dark.svg` · `pitchlens-logo-light.svg` | Logo horizontal: marca + nome + tagline, nos dois temas. |
| `web/favicon.svg` | Favicon: só o P, branco quente; fica preto quando o navegador está no tema claro. |
| `web/index.html` | A marca inline no topo do app (mesmos caminhos do SVG), na cor do texto. |

## A marca

Um **P que é uma lupa**: o bojo é a **lente** (um anel), o ponto no centro é a **marca do meio-campo**
e a haste, inclinada para a esquerda e separada da lente por um recorte, é o **cabo**.
Lê-se como olhar o campo de perto: cada jogador em foco.

Regras: sempre em uma cor só (branco quente `#f0ede6` sobre escuro, preto `#1a1a1a` sobre claro);
nunca com fundo, sombra, contorno ou gradiente; área de respiro de pelo menos meia altura da marca em
volta; tamanho mínimo 16 px de altura (favicon).

## Nome e tagline

- Nome: **Pitchlens**, Inter peso 500, espaçamento −1%. Nunca em caixa alta, nunca em negrito.
- Tagline: **EVERY PLAYER, IN FOCUS.** em caixa alta, espaçamento de +20%, cor apagada, sempre após uma
  linha vertical fina quando ao lado do nome. Fica em inglês também na interface em português.

## Paleta

| Papel | Escuro | Claro |
|---|---|---|
| Marca | `#f0ede6` | `#1a1a1a` |
| Fundo do logo | `#1a1a1a` | `#f5f4f0` |
| Texto apagado | `#8a8a88` | `#8a8a86` |
| Acento do app | `#8b5cf6` | `#7c3aed` |

## Tipografia

Inter para interface (500 no nome); Cascadia Code / JetBrains Mono para números e IDs.

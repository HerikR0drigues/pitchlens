# Pitchlens — notas para o Claude

Ferramenta local, código aberto (MIT), que **lê (somente leitura)** a memória do Football Manager 27 em execução e
mostra os jogadores do save com filtros. Repositório público: README em inglês (`README.md`) e português
(`README.pt-BR.md`). O mapa da memória e o método de engenharia reversa estão em **`docs/TECHNICAL.md`** — mantenha
esse arquivo atualizado quando mapear algo novo.

## Estrutura
- `fmreader.py` — leitura da memória (ctypes + WinAPI). Só `PROCESS_VM_READ | PROCESS_QUERY_INFORMATION`.
  **O app nunca escreve no processo.** Constantes de offset no topo; `ATTRIBUTES`, `POSITIONS`, `GROUPS`,
  `GROUP_INDEX`, `preferred_foot()`, data do jogo estimada em `_game_date()`.
- `faces.py` — fotos do facepack do usuário (pasta Documentos via Windows, índice uid → arquivo). Fotos nativas do FM27 ficam em bundles do Unity e não são lidas.
- `scout.py` — servidor `http.server` em `127.0.0.1:8770` (cai para a próxima porta livre; se já houver um scout
  rodando, só abre o navegador). Rotas: `/`, `/api/ping`, `/api/players`, `/api/refresh`, `/api/player?uid=`, `/api/face?uid=`,
  arquivos estáticos de `web/`. Erros vêm com `error_code` (`not_running`, `no_save`, `access`, `read_error`).
- `web/` — `index.html`, `style.css`, `app.js`, `i18n.js` (textos EN/PT, nomes de atributos e posições).
  Sem build, sem CDN. Parâmetros de URL: `?lang=en|pt&theme=dark|light&sit=<situacao>&q=<busca>&p=<uid>`.
- `tools/` — `memscan.py`, `find_attrs.py`, `modules.py` (pesquisa) e `screenshots.py` (prints do README via Edge headless).
- `Pitchlens.exe` (fonte em `launcher/Pitchlens.cs`, C# 5 — o csc do .NET Framework não aceita sintaxe nova; build com `launcher\build.bat`) é a janela: WinForms + WebView2 (`runtime/`), liga `pythonw Pitchlens.pyw --server --port N`, chama `/api/quit` ao fechar e cria os atalhos na 1ª vez. Neste PC `.py/.pyw` não têm associação de arquivo e o usuário não quer ver cmd nem Edge.

## Regras
- Commits sem `Co-Authored-By` (nem outra atribuição ao Claude).
- Código, comentários, docstrings e mensagens das ferramentas em **inglês** (projeto público). Textos da
  interface ficam no `web/i18n.js` (EN/PT).
- Nada de janela de console: tudo que o app abre usa `CREATE_NO_WINDOW` ou roda dentro do `Pitchlens.exe`.

## Dicas de ambiente
- Python 3.14 via `py`. Com `py -I`, a pasta atual sai do `sys.path` (usar `sys.path.insert(0, '.')`) e
  `PYTHONIOENCODING` é ignorado (usar `sys.stdout.reconfigure`).
- Para testar sem atrapalhar o app do usuário: `py scout.py --no-browser --port 8771`.
- O primeiro `/api/players` leva 15–35 s (lê ~80 mil jogadores).
- Prints: com o servidor de teste rodando, `py tools/screenshots.py 8771 <uid>` gera `docs/img/*.png`.

## Validações conhecidas (save do autor, FM27 27.0.x Steam)
- CA/PA: Neymar 138/190; Lamine Yamal 194/195.
- Pé: Cristiano Ronaldo, Vinícius Jr. e Martinelli destros; Raphinha canhoto; Dembélé ambidestro.
- Listas: conferir com 1 jogador que o jogo mostra na lista de transferências e 1 na de empréstimos.
- Data do jogo: o maior início de contrato repetido 3+ vezes bateu com a data do jogo (17/04/2027).

## Achados fora do app (pesquisa)
- Dinheiro é guardado em libras (int32). Saldo do clube: `club +0x30 -> +0x150 -> +0x0C`.
- Cláusulas de transferência mostradas na tela são cópias temporárias recriadas pela UI do jogo; o registro
  fixo usa um formato compacto ainda não decodificado. Não gravar nessas cópias (pode travar o jogo).

## Ideias futuras
- Filtro "emprestado agora" (registros `0x4F2A0F8` com data futura).
- Salário, valor de mercado e reputação (`-0x2C..-0x32` antes do vtable parecem reputações).

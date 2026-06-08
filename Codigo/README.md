# Swagger to SDK

Extensão para o **Visual Studio Code** que gera um **SDK TypeScript tipado** a partir de uma especificação **OpenAPI/Swagger**. O objetivo é eliminar o *boilerplate* de integração com APIs REST: importe a documentação OpenAPI (arquivo local ou URL) e a extensão gera as funções de acesso aos *endpoints*, suas tipagens e a camada de transporte HTTP.

> TCC — Engenharia de Software, PUC Minas. Autor: Arthur do Nascimento Sita Gomes.

---

## Funcionalidades

- **Importação de OpenAPI** a partir de arquivo local (`.json`, `.yaml`, `.yml`) ou URL pública.
- **Validação** do documento (OpenAPI 3.x) antes da geração.
- **Geração de funções** que conectam aos *endpoints*, nomeadas por `operationId` (ou por `método + caminho` quando ausente, com tratamento de colisões).
- **Tipagem estática completa**: `schemas`, parâmetros (`path`, `query`, `header`, `cookie`), `requestBody` e respostas indexadas por código de *status*.
- **Adaptadores HTTP** selecionáveis: `fetch` (nativo), `axios` e `react-query`.
- **Recarregar (reload)** a especificação a partir da fonte salva, com um clique.
- **Configuração** de URL base, adaptador padrão e diretório de saída.
- Interface integrada na **barra lateral** do VS Code (sem sair do editor).

---

## Requisitos

- Visual Studio Code `^1.85.0`.

---

## Instalação

A partir do arquivo `.vsix`:

```bash
code --install-extension swagger-to-sdk-<versão>.vsix
```

Ou pela paleta de comandos: **Extensions: Install from VSIX...**

---

## Uso

Abra o ícone **Swagger to SDK** na barra de atividades. A barra lateral apresenta um fluxo em três etapas:

1. **Configure** — defina o diretório de saída, a URL base (opcional) e o adaptador HTTP.
2. **Import spec** — informe o caminho/URL da especificação OpenAPI e importe (a extensão baixa, valida e processa).
3. **Generate SDK** — gera os arquivos do cliente no diretório de saída.

Ações adicionais:

- **Reload OpenAPI** — recarrega a especificação a partir da fonte previamente importada.
- **Regenerate types** — regenera apenas o arquivo de tipos (`types.ts`).
- **Clear** — limpa o estado da atividade na interface.

Também disponível pela paleta de comandos (`Cmd/Ctrl+Shift+P`):

| Comando | Ação |
| :-- | :-- |
| `Swagger to SDK: Import OpenAPI` | Importa uma especificação (entrada por caminho ou URL) |
| `Swagger to SDK: Generate SDK` | Gera o SDK a partir da especificação importada |
| `Swagger to SDK: Open Extension Tab` | Abre/foca a aba da extensão |

---

## Arquivos gerados

No diretório de saída (padrão `generated-sdk`):

| Arquivo | Conteúdo |
| :-- | :-- |
| `types.ts` | Tipos de `schemas`, parâmetros, `requestBody` e respostas por *status* |
| `transport.ts` | Abstração de transporte HTTP (implementação `fetch` ou `axios`) |
| `api.ts` | Funções que conectam aos *endpoints*, com assinaturas tipadas |
| `index.ts` | Reexportações (*barrel*) dos módulos gerados |
| `react-query.ts` | *Hooks* do React Query (apenas quando `adapter = react-query`) |

---

## Configurações

Disponíveis em **Settings** sob o *namespace* `plfEs`:

| Configuração | Tipo | Padrão | Descrição |
| :-- | :-- | :-- | :-- |
| `plfEs.importPath` | string | `""` | Caminho de arquivo ou URL da especificação OpenAPI |
| `plfEs.outputPath` | string | `generated-sdk` | Diretório de saída dos arquivos gerados |
| `plfEs.baseURL` | string | `""` | URL base opcional, usada como prefixo das requisições |
| `plfEs.adapter` | enum (`fetch`, `axios`, `react-query`) | `fetch` | Adaptador HTTP usado pelo SDK gerado |

> Métodos HTTP suportados na geração: `get`, `post`, `put`, `patch`, `delete`, `head`, `options`.

---

## Desenvolvimento

```bash
npm install        # instala dependências
npm run compile    # typecheck + emite out/ (tsc)
npm run watch      # compilação em modo observação
npm run bundle     # empacota tudo em um único out/extension.js (esbuild)
npm run lint       # eslint
npm run test       # testes (vitest)
```

Depurar a extensão: pressione `F5` no VS Code (abre uma janela *Extension Development Host*).

### Empacotamento e publicação

O empacotamento usa **bundle único** (esbuild): o `.vscodeignore` envia apenas `out/extension.js` (com `yaml` e os módulos internos *inlined*), por isso o passo de *bundle* é obrigatório antes de empacotar.

```bash
npm run package          # build + bundle + gera o .vsix
npm run publish-patch    # bump patch + build + verifica + empacota (via scripts/release.sh)
```

O script `scripts/release.sh` executa a sequência correta e **verifica** que o *bundle* é autocontido (sem `require` relativo, `yaml` *inlined*, `activate` exportado) antes de empacotar:

```bash
./scripts/release.sh                       # build + verifica + empacota (.vsix)
./scripts/release.sh --bump patch          # incrementa a versão e empacota
./scripts/release.sh --bump patch --publish # também publica no Marketplace (requer VSCE_PAT)
```

---

## Estrutura do projeto

```
src/
├─ extension.ts              # ponto de entrada (activate/deactivate)
├─ ui/
│  ├─ ExtensionController.ts # orquestração (camada anticorrupção)
│  ├─ SidebarViewProvider.ts # webview da barra lateral
│  └─ messages.ts            # contratos de mensagem UI ↔ extensão
├─ services/
│  ├─ parsers/               # OpenAPILoader, OpenAPIValidator, PathParser, SchemaParser
│  ├─ generators/            # SDKGenerator, TypeGenerator, ReactQueryGenerator,
│  │                         #   OperationNameResolver, FileWriter
│  └─ config/                # ConfigManager
├─ models/                   # tipos de dado (OpenAPI, Operation, Schema, Parameter, Config, ...)
└─ utils/                    # naming, typeNames (geração de identificadores e nomes de tipo)
```

A documentação de projeto (diagramas e descrições) está em `docs/`.

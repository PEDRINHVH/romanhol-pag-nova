# No Limite

Loja responsiva em português, com 399 produtos e 1.421 variações do catálogo público da Norisk. A marca da loja é **No Limite**. Por decisão do proprietário, as fotografias preservam a marca Norisk original e são apresentadas com fundo transparente.

A interface segue o manual **Asa Clean 2.0**: arquivos mestres da marca em `public/assets/brand/no-limite-*`, estilos compartilhados em `public/brand.css` e ajustes do checkout em `public/brand-checkout.css`. Essas camadas são carregadas após os estilos funcionais e usam as fontes locais Sora e Inter.

## Executar

Execute `npm ci` e `npm run preview:local`, depois abra `http://127.0.0.1:5173`. O preview usa o mesmo backend de pagamentos, SQLite persistente em `.local/` e credenciais de `.env.local`. A UTMify recebe pedidos de teste nesse preview; a geração do Pix é real e não executa pagamento.

Na Hostinger, selecione **Next.js**, Node.js **22 ou 24**, raiz do projeto `./` e comando de compilação `npm run build`. O build gera `.next/standalone/server.js`, com o catálogo e as imagens incluídos. Use `npm start` se o painel solicitar um comando de inicialização; `PORT` e `HOSTNAME` são lidos pelo servidor Next.js. Não configure `dist` como saída: a implantação utiliza a saída padrão `.next` do Next.js.

O frontend em `nolimitemotos.com` encaminha `/api/*` ao backend publicado em `https://nolimit-capacetes.tarcalmix.chatgpt.site`. Esse backend mantém pagamentos, integrações, pedidos e o banco D1 (`DB`); suas credenciais permanecem no ambiente do servidor atual. Não é necessário copiar chaves para a Hostinger neste modelo. O backend deve continuar publicado e acessível. O domínio principal e `www` são permitidos explicitamente; um domínio temporário diferente precisa ser cadastrado antes de usar checkout ou tracking.

O site inclui catálogo, busca, filtros, ordenação, páginas de produtos, galerias ampliadas, escolha de tamanho, favoritos e sacola persistente no navegador. As rotas usam hash para funcionar em hospedagem estática.

O banner tem altura reduzida e os cartões de modelos usam fotos do catálogo. Viseiras coloridas aparecem como adicionais opcionais na página do capacete, na sacola e no checkout; escolher uma cor não adiciona nem cobra o item. O botão adiciona uma linha própria à sacola, atualiza o total e evita inclusões repetidas acidentais.

Ao adicionar um produto ou uma viseira pela página do produto, a loja redireciona automaticamente para o checkout. A escolha de tamanho continua obrigatória. Adicionais escolhidos na sacola ou no checkout atualizam a seleção na própria página.

`public/visor-utils.js` cruza modelos exatos do catálogo para oferecer somente viseiras externas coloridas compatíveis. Há opções para Carbon R, City, Flow, Force, Razor, Route e Strada II. Force II e outros modelos sem correspondência aguardam cadastro confirmado; Force não é tratado como Force II. A disponibilidade usa os dados do catálogo; não existe sincronização contínua de estoque do fornecedor.

## Catálogo e preços

O Tapete Bandeja 3D ProtectCar é cadastrado separadamente em `public/protectcar-data.js`, preservado nas regenerações do catálogo Norisk. Somente esse produto usa configuração de veículo (tipo, marca, modelo, ano, cor e textura) e comparadores de antes/depois na descrição. Os quatro kits custam R$ 97,83, R$ 123,50, R$ 138,90 e R$ 167,96; o servidor valida as escolhas e registra a configuração no pedido. Dados e imagens de referência: `https://www.lojaprotectcar.com/`, consultados em 14/10/2026. A lista de veículos representa as opções dessa referência, sem sincronização contínua de estoque ou compatibilidade.

- Toda a linha de capacetes Force II: R$ 179,90, inclusive variações.
- Demais produtos: preço Pix de referência multiplicado por `179.90 / 854.90`, arredondado a dois decimais. Quando a API não informa Pix, o importador aplica a condição de 5% à vista apresentada pela origem.
- Variações podem ter preços diferentes. O preço exibido antes da escolha é o menor valor do produto.
- O produto 692 não tem preço na origem e permanece com compra desabilitada.
- Não há alegação pública de desconto calculado sobre o preço da outra marca.

`data/catalog.json` conserva a procedência. `public/data/catalog.json` contém a projeção usada pela loja. O manifesto `public/data/image-manifest.json` associa cada imagem de origem a um arquivo local; as imagens com a marca original usam `status: original`, com remoção de fundo registrada separadamente.

## Integração de vendas

Checkout em quatro etapas: dados pessoais, endereço, frete e pagamento via Pix. A escolha de frete aparece após validar o CEP e o endereço; a entrega padrão é grátis e o Sedex é opcional. O resumo da sacola mostra apenas os valores, sem seletor de frete. A oferta de aniversário é explicitamente condicionada ao Pix. A identificação visível do processador é Pagar.me.

`worker/payments.mjs` integra a API documentada em https://docs.ironpayapp.com.br, cadastra os produtos da loja sob demanda, recalcula os preços no servidor, valida CPF/endereço/variante/quantidade e persiste pedidos e chaves de idempotência. O Pix é apresentado como QR Code local e copia e cola. Repetir a mesma solicitação retorna o mesmo pedido. Uma resposta incerta do provedor nunca dispara automaticamente outra cobrança.

`GET /api/orders/:id` consulta o status autenticado do provedor; o identificador público é imprevisível e a resposta não contém dados pessoais. `POST /api/payment/postback` também verifica o pagamento na API, sem confiar no status informado pelo callback. Valor, hash e método de pagamento precisam corresponder ao pedido. Os valores `available: null` não representam confirmação de estoque do fornecedor.

Meta Pixel + CAPI cobrem PageView, ViewContent, Search, AddToWishlist, AddToCart, InitiateCheckout e AddPaymentInfo. Purchase depende de pagamento confirmado e usa o mesmo ID de deduplicação no navegador e servidor. UTMify recebe as etapas dos pedidos. Ambos respeitam a escolha de medição do visitante. As entregas de eventos de pedidos possuem deduplicação e fila persistente de retry.

O proprietário autorizou acesso público em 13/10/2026, aplicado à política do Site. Callbacks externos precisam alcançar a aplicação sem login: confirmar que o dispatch aceita requisições anônimas após cada alteração de acesso. O polling no checkout funciona; confirmação após fechar a página exige callback acessível ou agendamento real do reconciliador. O handler `scheduled` existe, mas não há cron provisionado pelo manifest. Não tratar um callback de teste vazio como comprovação de pagamento real.

Manutenção: `POST /api/internal/reconcile` exige `Authorization: Bearer <PAYMENT_RECONCILE_TOKEN>`, aguarda lotes de até 20 pedidos e 20 retries e retorna apenas contadores. Uma falha individual não interrompe os demais; falhas retornam HTTP 503. O workflow `reconcile-payments.yml` no repositório GitHub usa o mesmo segredo via Actions, cron a cada cinco minutos e execução manual. GitHub pode atrasar ou descartar agendamentos e desativa schedules em repositórios públicos após 60 dias sem atividade; o cron não substitui o postback. Configure o segredo nos dois serviços antes de habilitar e valide com `workflow_dispatch`.

Compras Meta: `META_PURCHASE_SOURCE=direct` (padrão) mantém Purchase próprio via CAPI e navegador. `META_PURCHASE_SOURCE=utmify` delega Purchase exclusivamente à integração nativa da Utmify, que deve estar configurada com o mesmo Pixel e envio somente de pagamentos aprovados. Ative esse modo somente após configurar essa integração. O backend continua enviando pedidos e retries à Utmify com consentimento e confirmação autenticada do pagamento; não faz fallback para Meta em falhas. Retries Meta pendentes são encerrados com código `utmify_managed`, e respostas de pedidos omitem `purchaseEventId` para impedir Purchase no navegador. Eventos Meta anteriores à compra permanecem ativos. Nenhum SDK adicional da Utmify é necessário nesse fluxo.

Variáveis: `PAYMENT_API_TOKEN`, `PAYMENT_RECONCILE_TOKEN`, `UTMIFY_API_TOKEN`, `META_ACCESS_TOKEN`, `META_PIXEL_ID`, `META_API_VERSION`, `META_PURCHASE_SOURCE` e `SHIPPING_AMOUNT_CENTS`. O modelo sem segredos está em `.env.example`. `UTMIFY_IS_TEST=true` é apenas para testes. Não alterar status de pedido para simular pagamento em produção.

## Verificação

`node --test tests/*.test.mjs` testa catálogo, viseiras, tracking e pagamentos com banco real local e gateway simulado, incluindo adulteração de preço, concorrência, timeout, idempotência e confirmação autenticada. `npm run typecheck` verifica o runtime. `node scripts/verify-site.mjs` confere catálogo e imagens.

Validação real em 12/10/2026: um pedido de teste com dois capacetes e uma viseira gerou Pix de R$ 348,20, com CRC válido e total conferido, sem pagamento. Reenvio da mesma chave manteve o único pedido; recarga e copia e cola foram verificados no navegador. UTMify aceitou o pedido de teste pendente e Meta aceitou PageView via CAPI. Evidências locais sem segredos em `image-audit/`; não publicadas.

Revisão mobile: início, catálogo, produto, sacola e checkout verificados em frames reais de 320, 375, 430 e 1280 pixels, sem overflow horizontal. Campos de 16px e controles móveis de pelo menos 44px; cabeçalho compacto no checkout e itens expansíveis com totais sempre visíveis. Fontes locais WOFF reduzem o conjunto carregável de 1,14 MB para 170 KB, preservando português. `scripts/optimize-fonts.py` permite regenerá-las com fontTools; as fontes geradas já estão versionadas.

## Arquivos

- `public/`: frontend editável e imagens.
- `worker/`: pagamentos e acompanhamento no servidor.
- `.next/standalone/`: servidor Next.js gerado para a Hostinger (não editar).
- `scripts/`: importação, projeção do catálogo e preparação das fotos.
- `.openai/hosting.json`: identidade do Site e configuração de publicação.
- `../output/no-limite/`: identidade visual final, com logos e guia.

As fontes Sora e Inter são distribuídas com as respectivas licenças em `public/assets/fonts/`. Fotografias e dados foram obtidos do catálogo público indicado pelo proprietário, em 12 de outubro de 2026.

# Diagnóstico do MVP (20/04/2026)

## Status atual

### O que já está sólido
- Arquitetura-alvo e proposta de valor estão claras: cidade 2D multiplayer com integração Solana e foco em interações on-chain.
- Frontend base está montado com Next.js + Phaser + Tailwind e estrutura organizada por domínio (`game`, `ui`, `solana`, `multiplayer`).
- Cena principal (`CityScene`) já tem:
  - movimento local,
  - colisão e câmera,
  - NPCs e interação,
  - chat local,
  - gatilho de conexão de carteira.
- Existe um esqueleto consistente para multiplayer “on-chain” via `OnChainMultiplayer`.
- O programa Anchor já define as instruções de negócio principais (`initialize_player`, `update_position`, `record_swap`, `record_transfer`, `record_bounty`, `change_outfit`, `delegate`, `undelegate`).

### Gaps críticos hoje (bloqueadores de demo robusta)
1. **Sessão on-chain ainda em modo mock** no `SessionManager`.
   - O próprio código explicita que está em “mock mode”.
   - Commits de estado só fazem log, sem transação real.
2. **Multiplayer on-chain também em modo simulado**.
   - `sendPositionTransaction` está comentado/stub.
   - Descoberta de outros players ainda depende de polling simplificado.
3. **Build do frontend quebrando** com erro de runtime no `next build` (react-dom-server).
4. **Lint não está operacional em CI local** porque o projeto pede setup interativo do ESLint no `next lint`.
5. **Programa Rust não compila** por conflito de versões/tipos no ecossistema Solana (`solana_instruction`/`Address` vs `Pubkey`) via `ephemeral-rollups-sdk`.
6. **Program ID placeholder** no contrato (`111111...`), indicando que deploy real ainda não está fechado.

## Diagnóstico objetivo para “vencer hackathon”

### Risco principal
Hoje o projeto demonstra **excelente direção técnica**, mas ainda depende de peças simuladas e builds quebrados. Em hackathon, isso costuma tirar pontos de “entrega funcional ao vivo”.

### O que precisa acontecer (ordem de impacto)

#### Prioridade P0 (obrigatório para demo vencedora)
1. **Restaurar pipeline de build/lint**
   - Fazer `next build` passar sem erro.
   - Fixar configuração de ESLint (sem prompt interativo).
2. **Fechar compilação do programa Anchor**
   - Resolver matriz de versões `anchor-lang` / `ephemeral-rollups-sdk` / crates Solana para eliminar erros de tipo incompatível.
3. **Eliminar mock path na narrativa principal da demo**
   - Se não der tempo de integração completa, definir claramente um “modo demo estável” com fallback explícito e métricas reais (sem travar).

#### Prioridade P1 (diferencial para pontuação alta)
4. **Conectar pelo menos 1 fluxo end-to-end on-chain real**
   - Ex.: `initialize_player + update_position` ou `record_swap` com prova em explorer/log de assinatura.
5. **Melhorar confiabilidade multiplayer percebida**
   - Trocar polling por subscription real quando possível, ou deixar a limitação transparente na apresentação.

#### Prioridade P2 (polimento final)
6. **Storytelling de produto para jurados**
   - Script de demo em 3 minutos com “before/after” do estado on-chain e impacto do MagicBlock.
7. **Observabilidade mínima**
   - Painel/overlay simples com status de sessão, assinatura de tx recente, latência e commit interval.

## Plano de execução sugerido (48h)

### Bloco 1 (0-8h)
- Corrigir `next build`.
- Configurar ESLint não interativo.
- Travar versões de dependências críticas.

### Bloco 2 (8-24h)
- Corrigir compilação Anchor.
- Deploy em devnet com `program_id` real.
- Validar 1 instrução on-chain de ponta a ponta.

### Bloco 3 (24-36h)
- Integrar frontend ao fluxo real mínimo.
- Testar sessão com wallet conectando/desconectando sem falhas.

### Bloco 4 (36-48h)
- Ensaiar demo com checklist (3 execuções seguidas sem erro).
- Gravar backup video demo (se rede/local falhar no palco).

## Critérios de “pronto para ganhar”
- `next build` e checagens básicas rodando sem intervenção manual.
- contrato compilando e deployado em devnet.
- pelo menos uma ação do jogador gerando transação verificável.
- demo ao vivo reproduzível em máquina limpa com passos curtos.

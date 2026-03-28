# Progress Tracker

App web para fazer tracking de rotinas (gym, estudo, corrida, flexibilidade, etc.) com sistema de gamificação:

- check diário de atividades
- pontuação por atividade
- bónus por dia perfeito
- penalização por falhas e dias saltados
- níveis e streaks
- rotina semanal por atividade
- histórico e métricas rápidas

## Stack

- React + Vite
- Persistência local com `localStorage`
- Vitest para testes unitários da lógica de progressão

## Começar

```powershell
npm install
npm run dev
```

## Scripts

```powershell
npm run dev
npm run build
npm run preview
npm run test
```

## Regras de pontuação (atuais)

- cada atividade concluída: `+15`
- dia perfeito (todas concluídas): `+30` extra
- dia incompleto: `-20` de penalização
- cada dia saltado entre check-ins: `-10`

> Os valores estão em `src/utils/progression.js` e no `SKIP_DAY_PENALTY` em `src/App.jsx`.

## Próximos passos sugeridos

- alinhar tipografia/cores/spacing 1:1 com o Figma
- adicionar autenticação para sincronizar progresso na cloud
- criar estatísticas semanais/mensais com gráficos

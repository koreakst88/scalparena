const PaperSignalStats = require('./paperSignalStats');

const DEFAULT_PROJECT_TARGET = 30;
const DEFAULT_DECISION_TARGET = 10;
const DECISIONS = ['ALLOW', 'CAUTION', 'BLOCK'];

class ResearchReadiness {
  static calculate(signals = [], options = {}) {
    const projectTarget = this._positiveInteger(options.projectTarget, DEFAULT_PROJECT_TARGET);
    const decisionTarget = this._positiveInteger(options.decisionTarget, DEFAULT_DECISION_TARGET);
    const projects = [
      this._summarizeProject('Pump V2.1', PaperSignalStats.filterByProject(signals, 'pump_v2')),
    ];
    const decisions = this._emptyDecisionCounts();

    projects.forEach((project) => {
      DECISIONS.forEach((decision) => {
        decisions[decision] += project.decisions[decision];
      });
    });

    const projectsReady = projects.filter((project) => project.resolved >= projectTarget).length;
    const decisionsReady = DECISIONS.filter((decision) => decisions[decision] >= decisionTarget).length;

    return {
      experimentId: options.experimentId || null,
      projectTarget,
      decisionTarget,
      projects,
      decisions,
      projectsReady,
      decisionsReady,
      ready: projectsReady === projects.length && decisionsReady === DECISIONS.length,
      startedAt: this._firstSignalDate(projects),
    };
  }

  static format(readiness) {
    const lines = [
      '🔬 RESEARCH READINESS',
      '━━━━━━━━━━━━━━━━━━━━',
      `Эксперименты: ${readiness.experimentId || 'current project cohorts'}`,
      `Цель: ≥${readiness.projectTarget} resolved на проект; ≥${readiness.decisionTarget} resolved на BTC-группу`,
    ];

    if (readiness.startedAt) lines.push(`Начало выборки: ${readiness.startedAt}`);

    readiness.projects.forEach((project) => {
      lines.push(
        '',
        `${project.label}: ${project.resolved}/${readiness.projectTarget} resolved` +
          ` | W:${project.watching} | N:${project.total}`,
        `BTC: ALLOW ${project.decisions.ALLOW} | CAUTION ${project.decisions.CAUTION} | BLOCK ${project.decisions.BLOCK}` +
          `${project.untaggedResolved ? ` | UNTAGGED ${project.untaggedResolved}` : ''}`
      );
    });

    lines.push(
      '',
      'Общая выборка по BTC decision:',
      `ALLOW ${readiness.decisions.ALLOW}/${readiness.decisionTarget} | ` +
        `CAUTION ${readiness.decisions.CAUTION}/${readiness.decisionTarget} | ` +
        `BLOCK ${readiness.decisions.BLOCK}/${readiness.decisionTarget}`,
      '',
      readiness.ready
        ? '✅ Выборка достигла минимального порога. Можно проводить сравнительный разбор до изменения фильтров.'
        : `⏳ Данных пока недостаточно: готовы проекты ${readiness.projectsReady}/${readiness.projects.length}, BTC-группы ${readiness.decisionsReady}/3.`,
      'Market Context остаётся research-only и ничего не блокирует.'
    );

    return lines.join('\n');
  }

  static _summarizeProject(label, signals) {
    const resolved = signals.filter((signal) => signal.status !== 'WATCHING');
    const decisions = this._emptyDecisionCounts();
    let untaggedResolved = 0;

    resolved.forEach((signal) => {
      const decision = this._getMarketDecision(signal);
      if (DECISIONS.includes(decision)) decisions[decision] += 1;
      else untaggedResolved += 1;
    });

    return {
      label,
      total: signals.length,
      resolved: resolved.length,
      watching: signals.length - resolved.length,
      decisions,
      untaggedResolved,
      firstSignalAt: this._minimumDate(signals.map((signal) => signal.created_at)),
    };
  }

  static _getMarketDecision(signal) {
    let metadata = signal?.signal_metadata ?? signal?.signalMetadata;
    if (typeof metadata === 'string') {
      try {
        metadata = JSON.parse(metadata);
      } catch (_error) {
        return null;
      }
    }

    return metadata?.marketContext?.decision || null;
  }

  static _emptyDecisionCounts() {
    return { ALLOW: 0, CAUTION: 0, BLOCK: 0 };
  }

  static _firstSignalDate(projects) {
    const date = this._minimumDate(projects.map((project) => project.firstSignalAt));
    return date ? date.slice(0, 10) : null;
  }

  static _minimumDate(values) {
    const timestamps = values
      .filter(Boolean)
      .map((value) => new Date(value).getTime())
      .filter(Number.isFinite);
    if (!timestamps.length) return null;
    return new Date(Math.min(...timestamps)).toISOString();
  }

  static _positiveInteger(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }
}

module.exports = ResearchReadiness;

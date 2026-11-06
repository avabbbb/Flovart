import { useEffect, useRef } from 'react';
import { Z } from '../utils/zLayers';
import { answerUiConfirm, registerUiConfirmHost, runUiConfirmExtra, useUiConfirmRequest } from '../services/uiConfirm';
import { GenerationPlanCard } from './GenerationPlanCard';

/** Renders the single pending in-app confirmation. Non-modal: the canvas keeps working behind it. */
export function ConfirmHost() {
  const request = useUiConfirmRequest();
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => registerUiConfirmHost(), []);
  useEffect(() => {
    if (!request) return;
    confirmRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') answerUiConfirm(request.id, false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [request]);
  if (!request) return null;
  return (
    <div className={'flovart-confirm theme-aware' + (request.plan ? ' flovart-confirm--plan' : '')} role="alertdialog" aria-labelledby="flovart-confirm-title" style={{ zIndex: Z.notification }}>
      <strong id="flovart-confirm-title">{request.title}</strong>
      {request.plan ? <GenerationPlanCard plan={request.plan} /> : request.body && <p>{request.body}</p>}
      <div className="flovart-confirm__actions">
        {request.extraLabel && <button type="button" onClick={() => runUiConfirmExtra(request.id)}>{request.extraLabel}</button>}
        <button type="button" onClick={() => answerUiConfirm(request.id, false)}>{request.cancelLabel}</button>
        <button type="button" ref={confirmRef} data-tone={request.tone} disabled={request.confirmDisabled} onClick={() => answerUiConfirm(request.id, true)}>{request.confirmLabel}</button>
      </div>
    </div>
  );
}

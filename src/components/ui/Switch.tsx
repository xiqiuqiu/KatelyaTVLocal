'use client';

interface SwitchProps {
  checked: boolean;
  label: string;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
}

/**
 * 设置面板共用的开关控件：role="switch" + 44×24 轨道，琥珀色开启态。
 */
export default function Switch({
  checked,
  label,
  onCheckedChange,
  disabled = false,
  className = '',
}: SwitchProps) {
  return (
    <button
      type='button'
      role='switch'
      aria-checked={checked}
      aria-label={label}
      className={`ui-switch ${className}`.trim()}
      data-checked={checked}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        onCheckedChange?.(!checked);
      }}
    >
      <span className='ui-switch-knob' aria-hidden='true' />
    </button>
  );
}

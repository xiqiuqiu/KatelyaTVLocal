interface CapsuleSwitchProps {
  options: { label: string; value: string }[];
  active: string;
  onChange: (value: string) => void;
  className?: string;
  'aria-label'?: string;
}

export default function CapsuleSwitch({
  options,
  active,
  onChange,
  className = '',
  'aria-label': ariaLabel,
}: CapsuleSwitchProps) {
  return (
    <div
      aria-label={ariaLabel}
      className={`ui-filter-tabs ${className}`}
      role='group'
    >
      {options.map((option) => (
        <button
          key={option.value}
          aria-pressed={active === option.value}
          onClick={() => onChange(option.value)}
          className='ui-filter-tab'
          type='button'
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

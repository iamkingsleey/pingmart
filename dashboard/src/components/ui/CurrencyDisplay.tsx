/**
 * @file components/ui/CurrencyDisplay.tsx
 * @description Renders a formatted Naira amount from kobo value.
 */
import { formatNaira } from '../../utils/currency';

interface Props {
  kobo: number;
  className?: string;
  short?: boolean;
}

export default function CurrencyDisplay({ kobo, className = '' }: Props) {
  return <span className={className}>{formatNaira(kobo)}</span>;
}

import { Math as OfficeMath, MathRun, MathFraction, MathRadical, MathSubScript, MathSuperScript, MathSubSuperScript,
  MathIntegral, MathSum, type MathComponent } from 'docx';
import type { MathNode } from '../model';
import { formulaMarkup, safeMathml } from './html';

function conversion(el: Element): MathComponent[] {
  const children = [...el.children].filter(child => child.localName !== 'annotation');
  const part = (index: number) => {
    if (!children[index]) throw new Error('Missing MathML argument');
    return conversion(children[index]);
  };
  switch (el.localName) {
    case 'math': case 'semantics': case 'mrow': case 'mstyle':
      return children.flatMap(conversion);
    case 'mi': case 'mn': case 'mo': case 'mtext': case 'ms':
      return [new MathRun(el.textContent || '')];
    case 'mspace': return [new MathRun(' ')];
    case 'mfrac':
      if (el.getAttribute('linethickness') === '0px' || el.hasAttribute('bevelled')) throw new Error('Nonstandard fraction');
      return [new MathFraction({ numerator: part(0), denominator: part(1) })];
    case 'msqrt': return [new MathRadical({ children: children.flatMap(conversion) })];
    case 'mroot': return [new MathRadical({ children: part(0), degree: part(1) })];
    case 'msub': return [new MathSubScript({ children: part(0), subScript: part(1) })];
    case 'msup': return [new MathSuperScript({ children: part(0), superScript: part(1) })];
    case 'msubsup': case 'munderover': {
      const operator = children[0]?.textContent;
      if (operator === '∑' || operator === '∫') {
        const MathOperator = operator === '∑' ? MathSum : MathIntegral;
        return [new MathOperator({ children: [], subScript: part(1), superScript: part(2) })];
      }
      if (el.localName === 'munderover') throw new Error('Unsupported stacked limits');
      return [new MathSubSuperScript({ children: part(0), subScript: part(1), superScript: part(2) })];
    }
    default: throw new Error('Unsupported MathML element');
  }
}
export function toOfficeMath(node: MathNode): OfficeMath | undefined {
  const markup = formulaMarkup(node, 'mathml') || (node.mathml && safeMathml(node.mathml));
  if (!markup) return;
  try {
    const doc = new DOMParser().parseFromString(markup, 'text/html');
    const math = doc.querySelector('math');
    if (!math) return;
    const children = conversion(math);
    return children.length ? new OfficeMath({ children }) : undefined;
  } catch { return; }
}

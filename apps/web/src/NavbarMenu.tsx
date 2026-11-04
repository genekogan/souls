import {useEffect,useLayoutEffect,useRef,useState,type ReactNode} from 'react';
import {createPortal} from 'react-dom';

/** A viewport-bounded popover with native controls, outside dismissal and keyboard focus return. */
export function NavbarMenu({label,trigger,children,className='',tooltip=label}:{label:string;trigger:ReactNode;children:ReactNode|((close:()=>void)=>ReactNode);className?:string;tooltip?:string}){
 const [open,setOpen]=useState(false),[opened,setOpened]=useState(false),[position,setPosition]=useState({top:0,left:8});
 const button=useRef<HTMLButtonElement>(null),panel=useRef<HTMLDivElement>(null);
 const close=()=>{setOpen(false);button.current?.focus();};
 useLayoutEffect(()=>{
  if(!open)return;
  setOpened(true);
  const place=()=>{const r=button.current?.getBoundingClientRect();const width=panel.current?.offsetWidth??260;setPosition({top:Math.min((r?.bottom??44)+8,Math.max(8,innerHeight-(panel.current?.offsetHeight??0)-8)),left:Math.max(8,Math.min(r?.left??8,innerWidth-width-8))});};
  place();panel.current?.querySelector<HTMLElement>('button,select,a,input')?.focus();
  addEventListener('resize',place);addEventListener('scroll',place,true);
  return()=>{removeEventListener('resize',place);removeEventListener('scroll',place,true);};
 },[open]);
 useEffect(()=>{
  if(!open)return;
  const outside=(e:PointerEvent)=>{if(!panel.current?.contains(e.target as Node)&&!button.current?.contains(e.target as Node))setOpen(false);};
  const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close();}};
  document.addEventListener('pointerdown',outside);document.addEventListener('keydown',key,true);
  return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',key,true);};
 },[open]);
 return <span className={'navbar-menu '+className} data-tooltip={tooltip}>
  <button ref={button} type="button" className="navbar-menu-trigger" aria-label={label} title={tooltip} aria-haspopup="dialog" aria-expanded={open} onClick={()=>setOpen(!open)} onKeyDown={e=>{if(e.key==='ArrowDown'){e.preventDefault();setOpen(true);}}}>{trigger}</button>
  {(open||opened)&&createPortal(<div hidden={!open} ref={panel} className={'navbar-popover '+className} role="dialog" aria-label={label} style={position} onKeyDown={e=>{
    const items=[...e.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),select,a[href],input')],index=items.indexOf(document.activeElement as HTMLElement);
    if(e.key==='Tab'&&(e.shiftKey&&index===0||!e.shiftKey&&index===items.length-1)){
      e.preventDefault();setOpen(false);
      if(e.shiftKey)button.current?.focus();else{const controls=[...document.querySelectorAll<HTMLElement>('button,summary,a[href],input,select,[tabindex="0"]')].filter(el=>el.getClientRects().length&&!panel.current?.contains(el));const next=controls[controls.indexOf(button.current!)+1];(next??button.current)?.focus();}
    }else if((e.key==='ArrowDown'||e.key==='ArrowUp')&&!(e.target instanceof HTMLSelectElement)){
      e.preventDefault();items[(index+(e.key==='ArrowDown'?1:-1)+items.length)%items.length]?.focus();
    }
  }} onBlur={e=>{if(e.relatedTarget instanceof Node&&!e.currentTarget.contains(e.relatedTarget)&&e.relatedTarget!==button.current)setOpen(false);}}>{typeof children==='function'?children(close):children}</div>,document.body)}
 </span>;
}

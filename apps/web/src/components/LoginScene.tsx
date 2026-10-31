import { BrandMark, useBrand } from './Brand';

/**
 * The job, played as paperwork on the desk: an invoice slides into a window
 * envelope and comes back settled. Built in CSS; plays once; reduced motion
 * and no-script show the finished state. Example names only, no real figures.
 */
export function LoginScene() {
  const brand = useBrand().data;
  const name = brand?.brandName ?? 'Brightloop';
  return (
    <div className="scene" aria-hidden="true">
      <div className="scene__sheet stock">
        <div className="scene__row">
          <span className="scene__brand">
            <BrandMark size={16} /> {name}
          </span>
          <span className="scene__muted">Tax invoice</span>
        </div>
        <p className="scene__title">
          Invoice <span className="fig">0042</span>
        </p>
        <div className="scene__lines">
          <span>Growth plan, 6 seats</span>
          <span className="fig">₹7,794.00</span>
          <span>Priority support</span>
          <span className="fig">₹1,999.00</span>
          <span>IGST 18%</span>
          <span className="fig">₹1,762.74</span>
        </div>
        <div className="scene__total">
          <span>Total</span>
          <span className="fig">₹11,555.74</span>
        </div>
        <p className="scene__paid">Paid</p>
      </div>
      <div className="scene__envelope stock">
        <div className="scene__window">
          <span>Example Kitchen</span>
          <span>2 Example Road, Pune</span>
        </div>
      </div>
      <div className="scene__card stock">
        <p>Paid by UPI just now, thank you for the reminder.</p>
        <span className="scene__muted">accounts@example.in</span>
      </div>
    </div>
  );
}

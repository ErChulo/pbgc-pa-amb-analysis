// Representative PA_AMB statistical/deterministic kernel (PoC only, not the engine).
// Integer minor units throughout (cents). No float touches money.
// - accrual_monthly_cents: B = alpha * S * Cbar, alpha in basis points,
//   service in milli-years (e.g. 20000 = 20.000 y), avg monthly comp in cents.
//   B_cents = alpha_bps * service_milli * avg_cents / (10000 * 1000 * 12?) -- see note:
//   Here avg is MONTHLY comp in cents; annualised inside: B_monthly = alpha*S*Cbar_monthly
//   so divisor = 10000 (bps) * 1000 (milli). i128 intermediate, exact.
// - sum_i64: sum over a memory slice (ptr/len) of i64 minor-unit values.
// - robust_median_abs / mean: simple passes over slice for descriptive stats.
// - delta_cents: PA - reconstructed, integer.
#![no_std]
use core::panic::PanicInfo;
#[panic_handler]
fn panic(_: &PanicInfo) -> ! { loop {} }

#[no_mangle]
pub extern "C" fn add(a: i32, b: i32) -> i32 { a.wrapping_add(b) }

#[no_mangle]
pub extern "C" fn accrual_monthly_cents(alpha_bps: i64, service_milli: i64, avg_monthly_cents: i64) -> i64 {
    // B = alpha * S * Cbar ; alpha_bps/10000, service_milli/1000
    let num: i128 = (alpha_bps as i128) * (service_milli as i128) * (avg_monthly_cents as i128);
    (num / 10_000_000i128) as i64
}

#[no_mangle]
pub extern "C" fn delta_cents(pa_cents: i64, recon_cents: i64) -> i64 { pa_cents.wrapping_sub(recon_cents) }

#[no_mangle]
pub extern "C" fn sum_i64(ptr: *const i64, len: usize) -> i64 {
    let mut s: i128 = 0;
    for i in 0..len { unsafe { s += *ptr.add(i) as i128; } }
    s as i64
}

#[no_mangle]
pub extern "C" fn count_outside(ptr: *const i64, len: usize, lo: i64, hi: i64) -> i64 {
    let mut n: i64 = 0;
    for i in 0..len { unsafe { let v = *ptr.add(i); if v < lo || v > hi { n += 1; } } }
    n
}

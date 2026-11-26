//! Three-way supertrait fan-in, kept dyn-compatible on purpose: the breadth
//! surface upcasts `&dyn CompositeContract` to `&dyn ReportContract`.

use crate::contracts::cacheable_contract::CacheableContract;
use crate::contracts::report_contract::ReportContract;
use crate::contracts::schedule_contract::ScheduleContract;

/// Anything that is simultaneously reportable, cacheable and schedulable.
pub trait CompositeContract: ReportContract + CacheableContract + ScheduleContract {}

/// Trait-object upcast: every [`CompositeContract`] is also a [`ReportContract`].
pub fn as_report_contract(component: &dyn CompositeContract) -> &dyn ReportContract {
    component
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn upcast_keeps_the_report_view() {
        let report = crate::reports::cash_flow_report::CashFlowReport::new();
        let composite: &dyn CompositeContract = &report;

        assert_eq!(
            as_report_contract(composite).slug(),
            crate::reports::cash_flow_report::CashFlowReport::SLUG
        );
    }
}

//! Calls whose body is picked by a rule only Rust has, never by the method
//! name: the trait in scope, a trait path, the type argument of an impl block,
//! the type the caller asks for, the receiver's own type before a reference to
//! it, and the target of `collect()` and `sum()`. In each pair below the
//! look-alike is written first.

use std::iter::Sum;

/// A repair ticket, captioned two ways.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Ticket {
    pub reference: String,
    pub minutes: u32,
}

impl Ticket {
    pub fn new(reference: &str, minutes: u32) -> Self {
        Self {
            reference: reference.to_string(),
            minutes,
        }
    }

    /// The long caption through the trait path: [`Brief`] and [`Verbose`] are
    /// both in scope here, so the method syntax would be ambiguous.
    pub fn long_caption(&self) -> String {
        Verbose::caption(self)
    }

    /// The stamp of a borrowed ticket. On an owned ticket the method syntax
    /// reaches [`Stamp`]'s instead.
    pub fn stamp(&self) -> String {
        format!("{} (kept)", self.reference)
    }
}

/// The long caption: a method of the same name as [`Brief`]'s.
pub trait Verbose {
    fn caption(&self) -> String;
}

/// The short caption.
pub trait Brief {
    fn caption(&self) -> &str;
}

impl Verbose for Ticket {
    fn caption(&self) -> String {
        format!("{} ({} min)", self.reference, self.minutes)
    }
}

impl Brief for Ticket {
    fn caption(&self) -> &str {
        &self.reference
    }
}

/// A stamp that takes the ticket by value. Method lookup tries the receiver
/// type before a reference to it, so on an owned ticket this method is found
/// before the inherent `Ticket::stamp`, whose receiver is `&Ticket`.
pub trait Stamp {
    fn stamp(self) -> String;
}

impl Stamp for Ticket {
    fn stamp(self) -> String {
        format!("{} (closed)", self.reference)
    }
}

/// A reading of a ticket, picked by the type the caller asks for.
pub trait Measure<T> {
    fn measure(&self) -> T;
}

impl Measure<String> for Ticket {
    fn measure(&self) -> String {
        format!("{} min", self.minutes)
    }
}

impl Measure<u32> for Ticket {
    fn measure(&self) -> u32 {
        self.minutes
    }
}

/// A tagged value: which `describe` a call reaches depends on the type
/// argument, one impl block per argument.
pub struct Tagged<T>(pub T);

impl<'a> Tagged<&'a str> {
    pub fn describe(&self) -> &'a str {
        self.0
    }
}

impl Tagged<u32> {
    pub fn describe(&self) -> String {
        format!("{} min", self.0)
    }
}

/// Tickets added up, built by `collect()` or by `sum()` over tickets.
#[derive(Debug, PartialEq, Eq)]
pub struct Workload {
    pub minutes: u32,
    pub count: usize,
}

impl FromIterator<Ticket> for Workload {
    fn from_iter<I: IntoIterator<Item = Ticket>>(tickets: I) -> Self {
        let mut workload = Workload {
            minutes: 0,
            count: 0,
        };
        for ticket in tickets {
            workload.minutes += ticket.minutes;
            workload.count += 1;
        }

        workload
    }
}

impl Sum<Ticket> for Workload {
    fn sum<I: Iterator<Item = Ticket>>(tickets: I) -> Self {
        tickets.collect()
    }
}

impl<'a> Sum<&'a Ticket> for Workload {
    fn sum<I: Iterator<Item = &'a Ticket>>(tickets: I) -> Self {
        tickets.cloned().collect()
    }
}

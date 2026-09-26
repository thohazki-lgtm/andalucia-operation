-- Deterministic representation backfills only. Preflight blocks ambiguous rows.
update bookings set reservation_date=arrival_date where reservation_date is null and arrival_date is not null;
update chargeable_item_records set charge_date=created_at::date where charge_date is null;
update chargeable_item_records set item_label=item_value where item_label is null and item_value is not null;
update chargeable_item_records set unit_price=amount where unit_price is null and amount is not null;
update chargeable_item_records set total_amount=amount where total_amount is null and amount is not null;
update guest_occasions g set
  manual_guest_name=coalesce(g.manual_guest_name,b.guest_name),
  manual_room_number=coalesce(g.manual_room_number,b.room_number),
  occasion_date=coalesce(g.occasion_date,b.reservation_date),
  occasion_time=coalesce(g.occasion_time,b.reservation_time),
  manual_table_number=coalesce(g.manual_table_number,b.table_number),
  manual_waiter_id=coalesce(g.manual_waiter_id,b.waiter_id)
from bookings b where g.booking_id=b.id;
update maintenance_issues set issue_date=reported_at::date where issue_date is null and reported_at is not null;

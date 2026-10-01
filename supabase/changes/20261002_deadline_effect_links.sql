-- Attach tested effects only to future party changes.
create trigger deadline_regional_seats_insert before insert on public.game_parties for each row execute function private.deadline_regional_seats();
create trigger deadline_regional_seats_update before update of regions,regional_seats_awarded,regional_seat_penalty on public.game_parties for each row execute function private.deadline_regional_seats();
create trigger deadline_party_effects after update of representation_penalty,presidential_rating_modifier on public.game_parties for each row when(old.representation_penalty is distinct from new.representation_penalty or old.presidential_rating_modifier is distinct from new.presidential_rating_modifier) execute function private.deadline_party_effects();


# belleameoman.com — WordPress + WooCommerce

Hosted on Hostinger. Products, prices, offers, blog posts and landing pages are published from the ERP
(Marketing → Website & SEO) through the WooCommerce / WordPress REST API.

- `belleame-theme/` → `wp-content/themes/belleame` (child of Twenty Twenty-Five: black & gold, bundled fonts, home page with live “New arrivals” and “Offers”)
- `mu-plugins/belleame-erp.php` → `wp-content/mu-plugins/` (one-time Oman shop settings: OMR with 3 decimals, Asia/Muscat, VAT-inclusive prices; ERP visitor tracking; reminder to connect the ERP)

Connect the ERP: WordPress → Users → Profile → Application Passwords → create “Belle Âme ERP”,
then in the ERP: Marketing → Connections → Website: platform WooCommerce, the shop address,
WordPress username + application password.

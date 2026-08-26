// groupe de sécurité cloud. Miroir obligatoire de host-ufw.sh : le
// pare-feu hôte ne sert à rien si le SG bloque en amont, et inversement. Les deux
// règles vivent dans le dépôt pour qu'aucune ne survive uniquement dans une
// console web (voir ../README.md pour le symptôme d'un oubli).
//
// Provider, backend et création du security group appartiennent au module racine
// de l'opérateur ; ce fichier ne déclare que les entrées du SFU.

variable "security_group_id" {
  description = "Security group attaché à l'hôte LiveKit"
  type        = string
}

// doit rester identique à rtc.port_range_start/end de ../livekit.yaml
resource "aws_vpc_security_group_ingress_rule" "livekit_media_udp" {
  security_group_id = var.security_group_id
  description = "LiveKit media"
  ip_protocol       = "udp"
  from_port         = 50000
  to_port           = 50100
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_vpc_security_group_ingress_rule" "livekit_ice_tcp" {
  security_group_id = var.security_group_id
  description = "LiveKit ICE/TCP"
  ip_protocol       = "tcp"
  from_port         = 7881
  to_port           = 7881
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_vpc_security_group_ingress_rule" "livekit_turn_udp" {
  security_group_id = var.security_group_id
  description = "LiveKit TURN"
  ip_protocol       = "udp"
  from_port         = 3478
  to_port           = 3478
  cidr_ipv4         = "0.0.0.0/0"
}

// 443/tcp porte le HTTPS du proxy et le TURN-TLS, chacun sur son IP
resource "aws_vpc_security_group_ingress_rule" "https_and_turn_tls" {
  security_group_id = var.security_group_id
  description = "HTTPS + TURN-TLS (`infra`/02)"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  cidr_ipv4         = "0.0.0.0/0"
}
